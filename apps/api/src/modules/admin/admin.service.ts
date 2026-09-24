import { Injectable, Logger } from '@nestjs/common';
import type {
  CreateCategoryInput,
  CreateCityInput,
  KycDecisionInput,
  SuspendUserInput,
  UpdateCategoryInput,
  UpdateCityInput,
} from '@onsite/validation';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { EncryptionService } from '../../common/encryption.service';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../common/errors';
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
 * real payout gateway exists yet — see payments.service.ts), and
 * ban/restore/adjust-verification-level (docs/15's body text names them, but
 * the binding API contract in docs/07 lists only `suspend`).
 *
 * `/admin/metrics` (below) was deferred for the same reason in the original
 * Phase 9 pass — "a dashboard aggregation query, not a trust/safety
 * primitive" — but that reasoning was specifically "no consumer yet," and
 * there now is one, by explicit request. See ai/memory.md, 2026-09-24.
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

    const last = page.at(-1);

    return {
      data,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
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

  /**
   * Full oversight detail for one task, not gated on a dispute existing —
   * the admin/tasks list links here for any task, per docs/15-admin-panel.md.
   * Shape deliberately mirrors DisputesService.getEvidenceBundle (money,
   * both parties, timeline, evidence) since that's the richest view already
   * trusted for admin eyes; the only difference is this one doesn't require
   * a Dispute row to exist first.
   */
  async getTaskDetail(taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        category: true,
        city: true,
        requester: true,
        assignedWorker: { include: { workerProfile: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        proofs: true,
        payment: true,
        disputes: { select: { id: true, status: true } },
      },
    });
    if (!task) throw new NotFoundError('Task not found.');

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      categoryName: task.category.name,
      cityName: task.city.name,
      riskLevel: task.riskLevel,
      riskFlags: task.riskFlags,
      createdAt: task.createdAt.toISOString(),
      deadlineAt: task.deadlineAt.toISOString(),
      location: { latitude: task.taskLat, longitude: task.taskLng, address: task.taskAddress },
      money: {
        budgetPaise: Number(task.budgetPaise),
        commissionPaise: Number(task.commissionPaise),
        workerPayoutPaise: Number(task.workerPayoutPaise),
      },
      payment: task.payment
        ? { status: task.payment.status, amountPaise: Number(task.payment.amountPaise) }
        : null,
      requester: {
        id: task.requester.id,
        displayName: task.requester.displayName,
        verificationLevel: task.requester.verificationLevel,
      },
      assignedWorker: task.assignedWorker
        ? {
            id: task.assignedWorker.id,
            displayName: task.assignedWorker.displayName,
            verificationLevel: task.assignedWorker.verificationLevel,
            ratingAvg: task.assignedWorker.workerProfile?.ratingAvg ?? null,
            completionRate: task.assignedWorker.workerProfile?.completionRate ?? null,
          }
        : null,
      proofs: await Promise.all(
        task.proofs.map(async (p) => ({
          type: p.type,
          url: p.storageKey ? await this.storage.presignGet(p.storageKey) : null,
          distanceFromTaskMeters: p.distanceFromTaskMeters,
          verificationFlags: p.verificationFlags,
          capturedAt: p.capturedAt?.toISOString() ?? null,
          fieldKey: p.fieldKey,
          fieldValue: p.fieldValue,
          noteBody: p.noteBody,
        })),
      ),
      statusHistory: task.statusHistory.map((h) => ({
        toStatus: h.toStatus,
        actorRole: h.actorRole,
        reason: h.reason,
        createdAt: h.createdAt.toISOString(),
      })),
      disputes: task.disputes,
    };
  }

  /**
   * A task counts toward "in progress" once published and until it reaches a
   * terminal state. DRAFT is excluded — nothing has happened yet.
   */
  private static readonly IN_PROGRESS_STATUSES = [
    'PUBLISHED',
    'MATCHING',
    'ASSIGNED',
    'WORKER_EN_ROUTE',
    'ARRIVED',
    'IN_PROGRESS',
    'SUBMITTED',
    'UNDER_REVIEW',
  ] as const;

  // ─── Dashboard ───────────────────────────────────────────────────────

  /**
   * docs/15-admin-panel.md's dashboard, "the operating picture, on one
   * screen." Every figure here is a plain aggregate over existing columns —
   * nothing new is tracked to produce it. Definitions chosen where the doc
   * doesn't pin one down, recorded here rather than left implicit:
   *
   * - "Active workers" = has a worker profile with `isAvailable = true`,
   *   not merely having one at all.
   * - "Completion rate" = of tasks that ever reached ASSIGNED, the share
   *   that reached COMPLETED or PAYMENT_RELEASED — a task-level rate, not
   *   an average of each worker's own `completionRate`.
   * - "Median time to match" = median of `assignedAt - publishedAt` over
   *   the 200 most recently assigned tasks, computed in application code.
   *   Postgres has `percentile_cont` for this, but raw SQL outside
   *   `geo.repository.ts` needs a written justification (ai/architecture-
   *   rules.md) and a 200-row in-memory median for an admin-only, low-QPS
   *   screen isn't worth spending that exception on.
   * - "Acceptance rate" = of task offers a worker responded to at all,
   *   the share that were accepted (declines and expiries both count as
   *   "responded," since an expiry is a worker who saw it and didn't act).
   */
  async getDashboardMetrics() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      usersTotal,
      activeWorkers,
      verifiedL2Plus,
      tasksToday,
      completedToday,
      inProgress,
      disputesOpen,
      kycQueueCount,
      flaggedTasks,
      safetyReports,
      assignedTotal,
      completedTotal,
      pendingPayoutsAgg,
      commissionTodayAgg,
      gmvTodayAgg,
      matchSample,
      offerCounts,
      cities,
      tasksTodayByCity,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.workerProfile.count({ where: { isAvailable: true } }),
      this.prisma.user.count({ where: { verificationLevel: { gte: 2 } } }),
      this.prisma.task.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.task.count({ where: { completedAt: { gte: startOfToday } } }),
      this.prisma.task.count({ where: { status: { in: [...AdminService.IN_PROGRESS_STATUSES] } } }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      this.prisma.kycSubmission.count({ where: { status: 'PENDING' } }),
      this.prisma.task.count({ where: { riskLevel: { not: 'LOW' } } }),
      this.prisma.report.count({ where: { status: 'OPEN' } }),
      this.prisma.task.count({ where: { assignedAt: { not: null } } }),
      this.prisma.task.count({ where: { status: { in: ['COMPLETED', 'PAYMENT_RELEASED'] } } }),
      this.prisma.payout.aggregate({ where: { status: 'PENDING' }, _sum: { amountPaise: true } }),
      this.prisma.task.aggregate({
        where: { completedAt: { gte: startOfToday } },
        _sum: { commissionPaise: true },
      }),
      this.prisma.task.aggregate({ where: { createdAt: { gte: startOfToday } }, _sum: { budgetPaise: true } }),
      this.prisma.task.findMany({
        where: { assignedAt: { not: null }, publishedAt: { not: null } },
        orderBy: { assignedAt: 'desc' },
        take: 200,
        select: { publishedAt: true, assignedAt: true },
      }),
      this.prisma.taskOffer.groupBy({ by: ['response'], _count: { _all: true }, where: { response: { not: null } } }),
      this.prisma.city.findMany({ select: { id: true, name: true } }),
      this.prisma.task.groupBy({ by: ['cityId'], _count: { _all: true }, where: { createdAt: { gte: startOfToday } } }),
    ]);

    const matchMinutes = matchSample
      .filter((t): t is { publishedAt: Date; assignedAt: Date } => t.publishedAt !== null && t.assignedAt !== null)
      .map((t) => (t.assignedAt.getTime() - t.publishedAt.getTime()) / 60_000)
      .sort((a, b) => a - b);
    const medianTimeToMatchMinutes = median(matchMinutes);

    const accepted = offerCounts.find((o) => o.response === 'ACCEPTED')?._count._all ?? 0;
    const respondedTotal = offerCounts.reduce((sum, o) => sum + o._count._all, 0);

    const cityNameById = new Map(cities.map((c) => [c.id, c.name]));
    const byCity = tasksTodayByCity.map((row) => ({
      city: cityNameById.get(row.cityId) ?? 'Unknown',
      tasksToday: row._count._all,
    }));

    return {
      usersTotal,
      activeWorkers,
      verifiedL2Plus,
      tasksToday,
      completedToday,
      inProgress,
      disputesOpen,
      completionRate: assignedTotal > 0 ? Math.round((completedTotal / assignedTotal) * 1000) / 10 : null,
      medianTimeToMatchMinutes: medianTimeToMatchMinutes !== null ? Math.round(medianTimeToMatchMinutes) : null,
      acceptanceRate: respondedTotal > 0 ? Math.round((accepted / respondedTotal) * 1000) / 10 : null,
      gmvTodayPaise: Number(gmvTodayAgg._sum.budgetPaise ?? 0),
      commissionTodayPaise: Number(commissionTodayAgg._sum.commissionPaise ?? 0),
      pendingPayoutsPaise: Number(pendingPayoutsAgg._sum.amountPaise ?? 0),
      kycQueueCount,
      flaggedTasks,
      safetyReports,
      byCity,
    };
  }

  // ─── Categories & cities ─────────────────────────────────────────────
  //
  // categories.controller.ts's own comment already says the intent: "a
  // category or city that is not active cannot be selected, and widening
  // the scope is an admin action rather than a deploy." This is that
  // admin action — it never existed until now, so `isActive` had no way to
  // ever change except a manual database edit.

  async listCategoriesAdmin() {
    const rows = await this.prisma.category.findMany({ orderBy: { name: 'asc' } });
    return rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      icon: c.icon,
      suggestedMinPaise: Number(c.suggestedMinPaise),
      suggestedMaxPaise: Number(c.suggestedMaxPaise),
      isActive: c.isActive,
    }));
  }

  async createCategory(adminId: string, adminIp: string | undefined, input: CreateCategoryInput) {
    const category = await this.prisma.category
      .create({
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description,
          icon: input.icon,
          suggestedMinPaise: BigInt(input.suggestedMinPaise),
          suggestedMaxPaise: BigInt(input.suggestedMaxPaise),
          isActive: input.isActive,
          // No category comes with proof requirements pre-defined by this
          // form — an admin adding a new task type sets those up in the
          // wizard's category config once real demand shows what evidence
          // actually matters for it. Starts as an empty checklist, not a
          // guess.
          defaultProofRequirements: [],
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictError('A category with this slug already exists.');
        }
        throw error;
      });

    await this.audit.record({
      actorUserId: adminId,
      actorIp: adminIp,
      action: 'CATEGORY_CREATE',
      entityType: 'Category',
      entityId: category.id,
      before: null,
      after: { slug: category.slug, name: category.name, isActive: category.isActive },
    });

    this.logger.log(`Category ${category.slug} created by admin ${adminId}.`);
    return { id: category.id };
  }

  async updateCategory(
    categoryId: string,
    adminId: string,
    adminIp: string | undefined,
    input: UpdateCategoryInput,
  ) {
    const existing = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!existing) throw new NotFoundError('Category not found.');

    const updated = await this.prisma.category.update({
      where: { id: categoryId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.icon !== undefined && { icon: input.icon }),
        ...(input.suggestedMinPaise !== undefined && { suggestedMinPaise: BigInt(input.suggestedMinPaise) }),
        ...(input.suggestedMaxPaise !== undefined && { suggestedMaxPaise: BigInt(input.suggestedMaxPaise) }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });

    await this.audit.record({
      actorUserId: adminId,
      actorIp: adminIp,
      action: 'CATEGORY_UPDATE',
      entityType: 'Category',
      entityId: categoryId,
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: updated.name, isActive: updated.isActive },
    });

    this.logger.log(`Category ${categoryId} updated by admin ${adminId}.`);
    return { success: true };
  }

  async listCitiesAdmin() {
    const rows = await this.prisma.city.findMany({ orderBy: { name: 'asc' } });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      state: c.state,
      latitude: c.centerLat,
      longitude: c.centerLng,
      radiusMeters: c.radiusMeters,
      isActive: c.isActive,
    }));
  }

  async createCity(adminId: string, adminIp: string | undefined, input: CreateCityInput) {
    const city = await this.prisma.city
      .create({
        data: {
          name: input.name,
          state: input.state,
          centerLat: input.latitude,
          centerLng: input.longitude,
          radiusMeters: input.radiusMeters,
          isActive: input.isActive,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictError('A city with this name already exists in that state.');
        }
        throw error;
      });

    await this.audit.record({
      actorUserId: adminId,
      actorIp: adminIp,
      action: 'CITY_CREATE',
      entityType: 'City',
      entityId: city.id,
      before: null,
      after: { name: city.name, state: city.state, isActive: city.isActive },
    });

    this.logger.log(`City ${city.name}, ${city.state} created by admin ${adminId}.`);
    return { id: city.id };
  }

  async updateCity(cityId: string, adminId: string, adminIp: string | undefined, input: UpdateCityInput) {
    const existing = await this.prisma.city.findUnique({ where: { id: cityId } });
    if (!existing) throw new NotFoundError('City not found.');

    const updated = await this.prisma.city.update({
      where: { id: cityId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.state !== undefined && { state: input.state }),
        ...(input.latitude !== undefined && { centerLat: input.latitude }),
        ...(input.longitude !== undefined && { centerLng: input.longitude }),
        ...(input.radiusMeters !== undefined && { radiusMeters: input.radiusMeters }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });

    await this.audit.record({
      actorUserId: adminId,
      actorIp: adminIp,
      action: 'CITY_UPDATE',
      entityType: 'City',
      entityId: cityId,
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: updated.name, isActive: updated.isActive },
    });

    this.logger.log(`City ${cityId} updated by admin ${adminId}.`);
    return { success: true };
  }
}

/** Sorted input required; returns null for an empty array. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? null;
  }
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  return lo !== undefined && hi !== undefined ? (lo + hi) / 2 : null;
}
