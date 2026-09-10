import { Injectable } from '@nestjs/common';
import type { UpdateProfileInput } from '@onsite/validation';
import { maskTail } from '@onsite/utils';
import { NotFoundError } from '../../common/errors';
import { EncryptionService } from '../../common/encryption.service';
import { toPublicUser, toPublicWorker, toSelfUser } from '../../common/projections';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
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
