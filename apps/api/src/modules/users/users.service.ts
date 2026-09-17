import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { DeleteAccountInput, UpdateProfileInput } from '@onsite/validation';
import { maskTail } from '@onsite/utils';
import { AuditService } from '../../common/audit.service';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../common/errors';
import { EncryptionService } from '../../common/encryption.service';
import { toPublicUser, toPublicWorker, toSelfUser } from '../../common/projections';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';

/**
 * Any task status that isn't one of these means the account has unfinished
 * business — money awaiting release, a proof awaiting review, an open
 * dispute — and deletion must wait. Deliberately NOT importing
 * ACTIVE_WORK_STATUSES/DISPUTABLE_STATUSES from tasks/transitions.ts: those
 * describe what a task's OWN state machine allows, which is a different
 * question from "is it safe to erase this person's identity right now," and
 * conflating the two would make this list silently drift if the state
 * machine's own sets are ever extended for unrelated reasons.
 */
const TASK_STATUSES_BLOCKING_DELETION = [
  'DRAFT',
  'PUBLISHED',
  'MATCHING',
  'ASSIGNED',
  'WORKER_EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'DISPUTED',
] as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async getSelf(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { workerProfile: { select: { id: true } } },
    });
    return toSelfUser(user);
  }

  /**
   * `NotFoundError` rather than a 403 when the id doesn't resolve: existence
   * of an arbitrary user id is not information a caller needs, so an invalid
   * id and someone else's id that happens not to exist look identical.
   *
   * Returns the richer `PublicWorker` shape (rating, completion rate, tasks
   * completed) when the profile belongs to a worker — the trust-page figures
   * docs/19-ui-design-system.md calls for — or plain `PublicUser` otherwise.
   */
  async getPublicProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        workerProfile: {
          select: { ratingAvg: true, ratingCount: true, tasksCompleted: true, completionRate: true },
        },
      },
    });
    if (!user) throw new NotFoundError('User not found.');
    return user.workerProfile ? toPublicWorker(user, user.workerProfile) : toPublicUser(user);
  }

  async updateSelf(userId: string, input: UpdateProfileInput) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.displayName !== undefined && { displayName: input.displayName }),
        ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
        ...(input.homeCity !== undefined && { homeCity: input.homeCity }),
        // Private fields. Never returned in any projection.
        ...(input.homeAddress !== undefined && { homeAddress: input.homeAddress }),
        ...(input.homeLocation !== undefined && {
          homeLat: input.homeLocation?.latitude ?? null,
          homeLng: input.homeLocation?.longitude ?? null,
        }),
      },
      include: { workerProfile: { select: { id: true } } },
    });
    return toSelfUser(user);
  }

  /**
   * Deletion is anonymization, not a row delete. A `Task`, `Payment`,
   * `LedgerEntry` or `Dispute` this person was ever party to must survive —
   * financial and dispute records cannot simply vanish because one side
   * closed their account, both for the other party's sake and because
   * India's tax/audit rules require retaining transaction records regardless
   * of what either party later does. What actually gets erased is
   * everything that identifies THIS person: email, phone, name, password,
   * Google id, home address. Every other row keeps its `userId` foreign key
   * pointing at this now-anonymized row, so a requester's task history still
   * reads "Deleted user" instead of breaking or silently disappearing.
   */
  async deleteAccount(userId: string, input: DeleteAccountInput): Promise<{ success: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found.');

    if (user.passwordHash) {
      if (!input.password) throw new ForbiddenError('Enter your password to confirm account deletion.');
      const valid = await this.passwords.verify(user.passwordHash, input.password);
      if (!valid) throw new ForbiddenError('That password is incorrect.');
    }

    const [asRequester, asWorker] = await Promise.all([
      this.prisma.task.count({
        where: { requesterId: userId, status: { in: [...TASK_STATUSES_BLOCKING_DELETION] } },
      }),
      this.prisma.task.count({
        where: { assignedWorkerId: userId, status: { in: [...TASK_STATUSES_BLOCKING_DELETION] } },
      }),
    ]);
    if (asRequester > 0 || asWorker > 0) {
      throw new BusinessRuleError(
        'You have a task still in progress. Finish, cancel, or wait for it to resolve before deleting your account.',
      );
    }

    const anonymizedEmail = `deleted-${randomUUID()}@deleted.onsite.local`;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status: 'DELETED',
          email: anonymizedEmail,
          emailVerifiedAt: null,
          phone: null,
          phoneVerifiedAt: null,
          passwordHash: null,
          googleId: null,
          displayName: 'Deleted user',
          avatarUrl: null,
          homeAddress: null,
          homeLat: null,
          homeLng: null,
          homeCity: null,
          notificationPrefs: undefined,
          // Invalidates every outstanding access token immediately — the
          // same mechanism AdminService.suspendUser uses. JwtAuthGuard
          // compares this against the token's own claim on every request.
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.pushSubscription.deleteMany({ where: { userId } }),
      this.prisma.workerProfile.updateMany({ where: { userId }, data: { isAvailable: false } }),
    ]);

    await this.audit.record({
      actorUserId: userId,
      action: 'ACCOUNT_DELETE_SELF',
      entityType: 'User',
      entityId: userId,
    });

    return { success: true };
  }

  async submitKyc(
    userId: string,
    input: {
      documentType: 'AADHAAR' | 'PAN' | 'DRIVING_LICENCE' | 'VOTER_ID' | 'PASSPORT';
      documentNumber: string;
      documentFrontKey: string;
      documentBackKey?: string;
      selfieKey: string;
    },
  ) {
    // Encrypted before it ever reaches a database row. No endpoint anywhere
    // in this codebase returns it, including this one — see
    // docs/16-security-requirements.md.
    const documentNumberEncrypted = this.encryption.encrypt(input.documentNumber);

    const submission = await this.prisma.kycSubmission.create({
      data: {
        userId,
        documentType: input.documentType,
        documentNumberEncrypted,
        documentFrontKey: input.documentFrontKey,
        documentBackKey: input.documentBackKey,
        selfieKey: input.selfieKey,
        status: 'PENDING',
      },
    });

    return {
      id: submission.id,
      status: submission.status,
      createdAt: submission.createdAt.toISOString(),
    };
  }

  async getOwnKycStatus(userId: string) {
    const submission = await this.prisma.kycSubmission.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!submission) return { status: 'NONE' as const };
    return {
      status: submission.status,
      rejectionReason: submission.rejectionReason,
      submittedAt: submission.createdAt.toISOString(),
    };
  }

  async addPayoutAccount(
    userId: string,
    input: {
      type: 'BANK' | 'UPI';
      accountNumber?: string;
      ifsc?: string;
      upiVpa?: string;
      panNumber: string;
    },
  ) {
    const panNumberEncrypted = this.encryption.encrypt(input.panNumber);

    const account = await this.prisma.payoutAccount.create({
      data: {
        userId,
        type: input.type,
        accountNumberMasked: input.accountNumber ? maskTail(input.accountNumber) : null,
        ifsc: input.ifsc,
        upiVpa: input.upiVpa,
        panNumberEncrypted,
        isDefault: (await this.prisma.payoutAccount.count({ where: { userId } })) === 0,
      },
    });

    return this.toPayoutAccountView(account);
  }

  async listPayoutAccounts(userId: string) {
    const accounts = await this.prisma.payoutAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return accounts.map((a) => this.toPayoutAccountView(a));
  }

  private toPayoutAccountView(account: {
    id: string;
    type: 'BANK' | 'UPI';
    accountNumberMasked: string | null;
    ifsc: string | null;
    upiVpa: string | null;
    isVerified: boolean;
    isDefault: boolean;
  }) {
    // Never the PAN, encrypted or otherwise, and never a full account number.
    return {
      id: account.id,
      type: account.type,
      accountNumberMasked: account.accountNumberMasked,
      ifsc: account.ifsc,
      upiVpa: account.upiVpa,
      isVerified: account.isVerified,
      isDefault: account.isDefault,
    };
  }
}
