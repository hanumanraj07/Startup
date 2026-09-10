import { Injectable, Logger } from '@nestjs/common';
import type { KycDecisionInput, SuspendUserInput } from '@onsite/validation';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { AuditService } from '../../common/audit.service';
import { EncryptionService } from '../../common/encryption.service';
import { BusinessRuleError, NotFoundError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { StorageService } from '../storage/storage.service';

/**
 * KYC review and user administration. docs/15-admin-panel.md: "At launch,
 * KYC review and dispute resolution are entirely manual, which makes this
 * the tool the business actually runs on." Dispute resolution itself lives
 * in DisputesService (already admin-callable) rather than here, so it is not
 * duplicated — see admin.controller.ts.
 *
 * Honestly out of scope for this pass, and recorded in TODO.md rather than
 * silently missing: `/admin/tasks/:id/block` (no BLOCKED status exists in
 * the task state machine to represent it), `/admin/payouts/:id/retry` (no
 * real payout gateway exists yet — see payments.service.ts), `/admin/metrics`
 * (a dashboard aggregation query, not a trust/safety primitive), and
 * ban/restore/adjust-verification-level (docs/15's body text names them, but
 * the binding API contract in docs/07 lists only `suspend`).
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly encryption: EncryptionService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  // ─── KYC ─────────────────────────────────────────────────────────────

  /** Queue sorted oldest first — docs/15: "Queue sorted oldest first." */
  async listKycQueue(limit: number, cursor?: string) {
    const cursorData = cursor ? decodeCursor<{ createdAt: string; id: string }>(cursor) : null;
    const submissions = await this.prisma.kycSubmission.findMany({
      where: {
        status: 'PENDING',
        ...(cursorData && { createdAt: { gt: new Date(cursorData.createdAt) } }),
      },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
      include: { user: { select: { displayName: true, email: true } } },
    });
    const hasMore = submissions.length > limit;
    const page = submissions.slice(0, limit);

    const data = await Promise.all(
      page.map(async (s) => ({
        id: s.id,
        userId: s.userId,
        userDisplayName: s.user.displayName,
        userEmail: s.user.email,
        documentType: s.documentType,
        // Presigned, short-lived, per docs/12: "Access is by short-lived
        // presigned GET, only for admin review."
        documentFrontUrl: await this.storage.presignGet(s.documentFrontKey),
        documentBackUrl: s.documentBackKey ? await this.storage.presignGet(s.documentBackKey) : null,
        selfieUrl: await this.storage.presignGet(s.selfieKey),
        // Decrypted ONLY here, in the admin review interface. See
        // encryption.service.ts's comment on why this is the one call site.
        documentNumber: this.encryption.decrypt(s.documentNumberEncrypted),
        createdAt: s.createdAt.toISOString(),
      })),
    );

    return {
      data,
      nextCursor: hasMore ? encodeCursor({ createdAt: page.at(-1)!.createdAt.toISOString(), id: page.at(-1)!.id }) : null,
    };
  }

  async decideKyc(
    submissionId: string,
    adminId: string,
    adminIp: string | undefined,
    input: KycDecisionInput,
  ): Promise<{ success: true }> {
    const submission = await this.prisma.kycSubmission.findUnique({ where: { id: submissionId } });
    if (!submission) throw new NotFoundError('KYC submission not found.');
    if (submission.status !== 'PENDING') {
      throw new BusinessRuleError('This submission has already been decided.');
    }

    const statusMap = { APPROVE: 'APPROVED', REJECT: 'REJECTED', RESUBMIT: 'RESUBMIT' } as const;
    const newStatus = statusMap[input.decision];

    await this.prisma.$transaction([
      this.prisma.kycSubmission.update({
        where: { id: submissionId },
        data: {
          status: newStatus,
          reviewedByAdminId: adminId,
          reviewedAt: new Date(),
          rejectionReason: input.decision === 'APPROVE' ? null : input.reason,
        },
      }),
      // Approval raises verification level to 2 and notifies the worker —
      // docs/12-trust-safety.md, docs/15-admin-panel.md.
      ...(input.decision === 'APPROVE'
        ? [this.prisma.user.update({ where: { id: submission.userId }, data: { verificationLevel: 2 } })]
        : []),
    ]);

    await this.audit.record({
      actorUserId: adminId,
      actorIp: adminIp,
      action: 'KYC_DECISION',
      entityType: 'KycSubmission',
      entityId: submissionId,
      before: { status: submission.status },
      after: { status: newStatus, reason: input.reason },
    });

    try {
      if (input.decision === 'APPROVE') {
        await this.notifications.notify(submission.userId, { event: 'KYC_APPROVED' });
      } else {
        await this.notifications.notify(submission.userId, {
          event: 'KYC_REJECTED',
          reason: input.reason ?? 'No reason given.',
        });
      }
    } catch (error) {
      this.logger.warn(`Notification dispatch failed for KYC decision on ${submissionId}: ${String(error)}`);
    }

    this.logger.log(`KYC submission ${submissionId} decided (${input.decision}) by admin ${adminId}.`);
    return { success: true };
  }

  // ─── Users ───────────────────────────────────────────────────────────

  async searchUsers(query: string, limit: number) {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { displayName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
        ],
      },
      take: limit,
      select: {
        id: true,
        displayName: true,
        email: true,
        phone: true,
        status: true,
        platformRole: true,
        verificationLevel: true,
        createdAt: true,
      },
    });
    return users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }));
  }

  /**
   * Suspension takes effect immediately, not at token expiry —
   * docs/12-trust-safety.md and docs/15-admin-panel.md, both verbatim on
   * this point. Bumping `tokenVersion` is what does it: JwtAuthGuard
   * compares it against the token's own claim on every request, so an
   * outstanding access token is worthless the moment this commits, with no
   * need to wait for it to expire.
   */
  async suspendUser(
    userId: string,
    adminId: string,
    adminIp: string | undefined,
    input: SuspendUserInput,
  ): Promise<{ success: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found.');
    if (user.platformRole === 'ADMIN') {
      throw new BusinessRuleError('Cannot suspend an admin account through this action.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'SUSPENDED', suspendedReason: input.reason, tokenVersion: { increment: 1 } },
    });

    await this.audit.record({
      actorUserId: adminId,
      actorIp: adminIp,
      action: 'USER_SUSPEND',
      entityType: 'User',
      entityId: userId,
      before: { status: user.status },
      after: { status: 'SUSPENDED', reason: input.reason },
    });

    try {
      await this.notifications.notify(userId, { event: 'ACCOUNT_SUSPENDED', reason: input.reason });
    } catch (error) {
      this.logger.warn(`Notification dispatch failed for suspension of ${userId}: ${String(error)}`);
    }

    this.logger.log(`User ${userId} suspended by admin ${adminId}.`);
    return { success: true };
  }

  // ─── Tasks (read-only oversight) ────────────────────────────────────

  async listTasks(filters: { status?: string; riskLevel?: string }, limit: number) {
    const tasks = await this.prisma.task.findMany({
      where: {
        ...(filters.status && { status: filters.status as never }),
        ...(filters.riskLevel && { riskLevel: filters.riskLevel as never }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        status: true,
        riskLevel: true,
        riskFlags: true,
        budgetPaise: true,
        createdAt: true,
      },
    });
    return tasks.map((t) => ({ ...t, budgetPaise: Number(t.budgetPaise), createdAt: t.createdAt.toISOString() }));
  }
}
