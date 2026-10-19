import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { DeleteAccountInput, UpdateProfileInput } from '@onsite/validation';
import { maskTail } from '@onsite/utils';
import { AuditService } from '../../common/audit.service';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../common/errors';
import { EncryptionService } from '../../common/encryption.service';
import { toPublicUser, toPublicWorker, toSelfUser } from '../../common/projections';
import { payoutProvider } from '../../config/env';
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

/** Enough for a bank account and a UPI ID with room to switch banks, without becoming a mule-account list. */
const MAX_PAYOUT_ACCOUNTS = 3;

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

  /**
   * Adds a bank account or UPI ID for payouts. Only the last four digits of
   * an account number are stored (the full number goes to the payout
   * partner), the PAN is encrypted, and the addition is audited.
   *
   * Verification: with the mock payout provider the account is verified at
   * once, standing in for the bank check. With no payout partner connected it
   * stays unverified, and payouts wait. (P4 replaces this with a real
   * verification: a penny drop that returns the holder's name.)
   */
  async addPayoutAccount(
    userId: string,
    input: {
      type: 'BANK' | 'UPI';
      accountHolderName?: string;
      accountNumber?: string;
      ifsc?: string;
      upiVpa?: string;
      panNumber: string;
    },
  ) {
    const active = await this.prisma.payoutAccount.findMany({ where: { userId, removedAt: null } });
    if (active.length >= MAX_PAYOUT_ACCOUNTS) {
      throw new BusinessRuleError(`You can keep up to ${MAX_PAYOUT_ACCOUNTS} payout accounts. Remove one first.`);
    }
    const masked = input.accountNumber ? maskTail(input.accountNumber) : null;
    const duplicate = active.some((a) =>
      input.type === 'BANK'
        ? a.type === 'BANK' && a.accountNumberMasked === masked && a.ifsc === input.ifsc
        : a.type === 'UPI' && a.upiVpa?.toLowerCase() === input.upiVpa?.toLowerCase(),
    );
    if (duplicate) throw new BusinessRuleError('That account is already added.');

    const verified = payoutProvider() === 'mock';
    const account = await this.prisma.payoutAccount.create({
      data: {
        userId,
        type: input.type,
        accountHolderName: input.type === 'BANK' ? input.accountHolderName : null,
        accountNumberMasked: masked,
        ifsc: input.type === 'BANK' ? input.ifsc : null,
        upiVpa: input.type === 'UPI' ? input.upiVpa : null,
        panNumberEncrypted: this.encryption.encrypt(input.panNumber),
        isVerified: verified,
        verifiedAt: verified ? new Date() : null,
        // The first verified account becomes where payouts go.
        isDefault: verified && !active.some((a) => a.isDefault && a.isVerified),
      },
    });

    await this.audit.record({
      actorUserId: userId,
      action: 'PAYOUT_ACCOUNT_ADDED',
      entityType: 'PayoutAccount',
      entityId: account.id,
      after: { type: account.type, accountNumberMasked: account.accountNumberMasked, ifsc: account.ifsc, upiVpa: account.upiVpa },
    });

    return this.toPayoutAccountView(account);
  }

  async listPayoutAccounts(userId: string) {
    const accounts = await this.prisma.payoutAccount.findMany({
      where: { userId, removedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return accounts.map((a) => this.toPayoutAccountView(a));
  }

  /** Payouts go to the default account, so only a verified one can be it. */
  async setDefaultPayoutAccount(userId: string, accountId: string) {
    const account = await this.requirePayoutAccount(userId, accountId);
    if (!account.isVerified) throw new BusinessRuleError('Only a verified account can receive payouts.');
    await this.prisma.$transaction([
      this.prisma.payoutAccount.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
      this.prisma.payoutAccount.update({ where: { id: account.id }, data: { isDefault: true } }),
    ]);
    return this.listPayoutAccounts(userId);
  }

  /**
   * Removed, not deleted: past payouts point at the account. A removed
   * default hands over to the newest other verified account, if any.
   */
  async removePayoutAccount(userId: string, accountId: string) {
    const account = await this.requirePayoutAccount(userId, accountId);
    const inFlight = await this.prisma.payout.count({ where: { payoutAccountId: account.id, status: 'PROCESSING' } });
    if (inFlight > 0) throw new BusinessRuleError('A payout to this account is on its way. Try again once it arrives.');

    await this.prisma.payoutAccount.update({ where: { id: account.id }, data: { removedAt: new Date(), isDefault: false } });
    if (account.isDefault) {
      const next = await this.prisma.payoutAccount.findFirst({
        where: { userId, removedAt: null, isVerified: true },
        orderBy: { createdAt: 'desc' },
      });
      if (next) await this.prisma.payoutAccount.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    await this.audit.record({
      actorUserId: userId,
      action: 'PAYOUT_ACCOUNT_REMOVED',
      entityType: 'PayoutAccount',
      entityId: account.id,
    });
    return this.listPayoutAccounts(userId);
  }

  private async requirePayoutAccount(userId: string, accountId: string) {
    const account = await this.prisma.payoutAccount.findFirst({ where: { id: accountId, userId, removedAt: null } });
    if (!account) throw new NotFoundError('Payout account not found.');
    return account;
  }

  private toPayoutAccountView(account: {
    id: string;
    type: 'BANK' | 'UPI';
    accountHolderName: string | null;
    accountNumberMasked: string | null;
    ifsc: string | null;
    upiVpa: string | null;
    isVerified: boolean;
    isDefault: boolean;
    verifiedAt: Date | null;
    createdAt: Date;
  }) {
    // Never the PAN, encrypted or otherwise, and never a full account number.
    return {
      id: account.id,
      type: account.type,
      accountHolderName: account.accountHolderName,
      accountNumberMasked: account.accountNumberMasked,
      ifsc: account.ifsc,
      upiVpa: account.upiVpa,
      isVerified: account.isVerified,
      isDefault: account.isDefault,
      verifiedAt: account.verifiedAt?.toISOString() ?? null,
      createdAt: account.createdAt.toISOString(),
    };
  }
}
