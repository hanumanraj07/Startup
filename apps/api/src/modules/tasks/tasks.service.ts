import { Injectable, Logger } from '@nestjs/common';
import type { CreateTaskInput, DeclineTaskInput, NearbyTasksInput, UpdateTaskInput } from '@onsite/validation';
import { calculateSplit } from '@onsite/money';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { ACTIVE_WORK_STATUSES } from '@onsite/types';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors';
import { AuditService } from '../../common/audit.service';
import { loadEnv } from '../../config/env';
import { GeoRepository, isWithinIndiaBounds } from '../../repositories/geo.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingQueue } from '../../queue/matching.queue';
import { NotificationService } from '../notifications/notification.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SafetyService } from '../safety/safety.service';
import { assertTransitionAllowed, checkTransition } from './transitions';
import { RiskService } from './risk.service';
import { PaymentsService } from '../payments/payments.service';

export interface FeedItem {
  id: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  distanceMeters: number;
  payoutPaise: number;
  deadlineAt: string;
  approximateAddress: string;
  requester: { displayName: string; verificationLevel: number };
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoRepository,
    private readonly risk: RiskService,
    private readonly payments: PaymentsService,
    private readonly matchingQueue: MatchingQueue,
    private readonly notifications: NotificationService,
    private readonly safety: SafetyService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
  ) {}

  /**
   * Runs the hard-prohibition check and, on a block, records it before
   * rethrowing — a blocked attempt is exactly the kind of signal trust &
   * safety needs visibility into (repeat offenders, escalating severity),
   * not just a 400 the client silently absorbs. See ai/memory.md, 2026-09-24.
   */
  private async assertNotProhibitedAndAudit(
    requesterId: string,
    title: string,
    description: string,
    actorIp: string | undefined,
    taskId?: string,
  ): Promise<void> {
    const reason = this.risk.findProhibitedMatch(title, description);
    if (reason) {
      await this.audit.record({
        actorUserId: requesterId,
        actorIp,
        action: 'PROHIBITED_TASK_BLOCKED',
        entityType: 'Task',
        entityId: taskId,
        after: { reason, title, description },
      });
    }
    this.risk.assertNotProhibited(title, description);
  }

  // ─── Discovery ───────────────────────────────────────────────────────

  /**
   * The worker feed. Runs the PostGIS radius search and returns open tasks
   * nearest first. Distance is measured server-side; the client never
   * calculates it and is never believed about it.
   */
  async findNearby(query: NearbyTasksInput, currentUserId: string, verificationLevel: number): Promise<FeedItem[]> {
    const { latitude, longitude } = query;
    if (latitude === undefined || longitude === undefined) return [];

    const categories = await this.prisma.category.findMany({
      where: { isActive: true, ...(query.categorySlug ? { slug: query.categorySlug } : {}) },
      select: { id: true, slug: true, name: true },
    });
    if (categories.length === 0) return [];

    const nearby = await this.geo.findNearbyTasks({
      workerLat: latitude,
      workerLng: longitude,
      radiusMeters: query.radiusMeters ?? 10_000,
      verificationLevel,
      categoryIds: categories.map((c) => c.id),
      excludeRequesterIds: [currentUserId],
      limit: query.limit,
      offset: 0,
    });
    if (nearby.length === 0) return [];

    const distanceById = new Map(nearby.map((t) => [t.id, t.distanceMeters]));

    const tasks = await this.prisma.task.findMany({
      where: { id: { in: nearby.map((t) => t.id) } },
      select: {
        id: true,
        title: true,
        taskAddress: true,
        deadlineAt: true,
        workerPayoutPaise: true,
        category: { select: { slug: true, name: true } },
        // Public projection only. No email, phone, home address or
        // requester coordinates. See docs/12-trust-safety.md.
        requester: { select: { displayName: true, verificationLevel: true } },
      },
    });

    return tasks
      .map((t) => ({
        id: t.id,
        title: t.title,
        categorySlug: t.category.slug,
        categoryName: t.category.name,
        distanceMeters: distanceById.get(t.id) ?? 0,
        payoutPaise: Number(t.workerPayoutPaise),
        deadlineAt: t.deadlineAt.toISOString(),
        approximateAddress: approximate(t.taskAddress),
        requester: { displayName: t.requester.displayName, verificationLevel: t.requester.verificationLevel },
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  // ─── Creation ────────────────────────────────────────────────────────

  async create(requesterId: string, input: CreateTaskInput, actorIp?: string) {
    const category = await this.prisma.category.findFirst({
      where: { slug: input.categorySlug, isActive: true },
    });
    if (!category) throw new NotFoundError('That category is not currently available.');

    // India-wide launch: any in-country location is accepted. The bounding
    // box only catches obviously-bogus coordinates (0,0, wrong hemisphere,
    // another country); it is not a precision border check. The nearest
    // active city is attached purely as a display label — it never gates
    // creation and worker matching never joins on it (see geo.repository.ts).
    if (!isWithinIndiaBounds(input.taskLocation.latitude, input.taskLocation.longitude)) {
      throw new BusinessRuleError('The task location must be within India.');
    }
    const city = await this.geo.findNearestCity(input.taskLocation.latitude, input.taskLocation.longitude);
    if (!city) {
      throw new BusinessRuleError('No service area is configured yet. Please try again shortly.');
    }

    // Hard prohibitions block creation outright; risk scoring below only
    // gates publication. See docs/12-trust-safety.md.
    await this.assertNotProhibitedAndAudit(requesterId, input.title, input.description, actorIp);
    const riskResult = this.risk.scoreRisk({
      title: input.title,
      description: input.description,
      budgetPaise: input.budgetPaise,
      deadlineAt: input.deadlineAt,
    });

    const env = loadEnv();
    const split = calculateSplit(input.budgetPaise, env.PLATFORM_COMMISSION_BPS, {
      gstOnCommissionBps: env.GST_ON_COMMISSION_BPS,
      tcsBps: env.TCS_BPS,
      tds194OBps: env.TDS_194O_BPS,
    });

    const requester = await this.prisma.user.findUniqueOrThrow({ where: { id: requesterId } });

    const task = await this.prisma.task.create({
      data: {
        requesterId,
        categoryId: category.id,
        cityId: city.id,
        title: input.title,
        description: input.description,
        status: 'DRAFT',
        taskLat: input.taskLocation.latitude,
        taskLng: input.taskLocation.longitude,
        taskAddress: input.taskAddress,
        taskPlaceName: input.taskPlaceName,
        taskPlaceId: input.taskPlaceId,
        // PRIVATE snapshot. Never exposed, never used for matching.
        requesterLat: requester.homeLat,
        requesterLng: requester.homeLng,
        budgetPaise: split.budgetPaise,
        commissionRateBps: split.commissionRateBps,
        commissionPaise: split.commissionPaise,
        gstPaise: split.gstPaise,
        tcsPaise: split.tcsPaise,
        tdsPaise: split.tdsPaise,
        workerPayoutPaise: split.workerPayoutPaise,
        deadlineAt: input.deadlineAt,
        proofRequirements: input.proofRequirements as object,
        minVerificationLevel: this.risk.minVerificationLevelForBudget(input.budgetPaise),
        riskLevel: riskResult.level,
        riskFlags: riskResult.flags,
        attachmentKeys: input.attachmentKeys ?? [],
      },
    });

    await this.prisma.taskStatusHistory.create({
      data: { taskId: task.id, toStatus: 'DRAFT', actorUserId: requesterId, actorRole: 'REQUESTER' },
    });

    return this.getById(task.id, requesterId);
  }

  async update(taskId: string, requesterId: string, input: UpdateTaskInput, actorIp?: string) {
    const task = await this.requireOwnedTask(taskId, requesterId);
    if (task.status !== 'DRAFT') {
      throw new BusinessRuleError('A task can only be edited while it is still a draft.');
    }

    if (input.title || input.description) {
      await this.assertNotProhibitedAndAudit(
        requesterId,
        input.title ?? task.title,
        input.description ?? task.description,
        actorIp,
        taskId,
      );
    }

    let cityId = task.cityId;
    if (input.taskLocation) {
      if (!isWithinIndiaBounds(input.taskLocation.latitude, input.taskLocation.longitude)) {
        throw new BusinessRuleError('The task location must be within India.');
      }
      const city = await this.geo.findNearestCity(input.taskLocation.latitude, input.taskLocation.longitude);
      if (!city) {
        throw new BusinessRuleError('No service area is configured yet. Please try again shortly.');
      }
      cityId = city.id;
    }

    let money: ReturnType<typeof calculateSplit> | undefined;
    if (input.budgetPaise !== undefined) {
      const env = loadEnv();
      money = calculateSplit(input.budgetPaise, env.PLATFORM_COMMISSION_BPS, {
        gstOnCommissionBps: env.GST_ON_COMMISSION_BPS,
        tcsBps: env.TCS_BPS,
        tds194OBps: env.TDS_194O_BPS,
      });
    }

    let category = task.categoryId;
    if (input.categorySlug) {
      const found = await this.prisma.category.findFirst({
        where: { slug: input.categorySlug, isActive: true },
      });
      if (!found) throw new NotFoundError('That category is not currently available.');
      category = found.id;
    }

    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.categorySlug !== undefined && { categoryId: category }),
        cityId,
        ...(input.taskLocation && {
          taskLat: input.taskLocation.latitude,
          taskLng: input.taskLocation.longitude,
        }),
        ...(input.taskAddress !== undefined && { taskAddress: input.taskAddress }),
        ...(input.deadlineAt !== undefined && { deadlineAt: input.deadlineAt }),
        ...(input.proofRequirements !== undefined && {
          proofRequirements: input.proofRequirements as object,
        }),
        ...(money && {
          budgetPaise: money.budgetPaise,
          commissionRateBps: money.commissionRateBps,
          commissionPaise: money.commissionPaise,
          gstPaise: money.gstPaise,
          tcsPaise: money.tcsPaise,
          tdsPaise: money.tdsPaise,
          workerPayoutPaise: money.workerPayoutPaise,
          minVerificationLevel: this.risk.minVerificationLevelForBudget(money.budgetPaise),
        }),
      },
    });

    return this.getById(taskId, requesterId);
  }

  // ─── Publication ─────────────────────────────────────────────────────

  /**
   * DRAFT → PUBLISHED, gated on captured payment. Publishing returns as soon
   * as the task is persisted — matching itself, including the PUBLISHED →
   * MATCHING transition, runs in the background worker process, kicked off
   * here by scheduling tier 0 with no delay. See docs/10-matching-engine.md
   * ("Publishing a task returns as soon as the task is persisted. Fan-out
   * never happens inside the request.") and matching.service.ts.
   *
   * This replaces the earlier Phase 4-era stub that did PUBLISHED → MATCHING
   * synchronously inline because no job runner existed yet. See
   * ai/memory.md.
   */
  async publish(taskId: string, requesterId: string) {
    const task = await this.requireOwnedTask(taskId, requesterId);

    if (task.riskLevel === 'HIGH') {
      throw new BusinessRuleError(
        'This task requires manual review before it can be published. Manual review is not available in this build yet — see docs/15-admin-panel.md for the intended flow.',
      );
    }
    if (task.deadlineAt.getTime() <= Date.now()) {
      throw new BusinessRuleError('This task\'s deadline has already passed. Update it before publishing.');
    }

    const captured = await this.payments.isCaptured(taskId);
    assertTransitionAllowed(task.status, 'PUBLISHED', 'REQUESTER', { paymentCaptured: captured });

    const env = loadEnv();
    const firstTier = env.MATCH_TIER_RADII_M[0] ?? 3_000;

    await this.prisma.$transaction([
      this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'PUBLISHED', publishedAt: new Date(), currentRadiusMeters: firstTier },
      }),
      this.prisma.taskStatusHistory.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: 'PUBLISHED',
          actorUserId: requesterId,
          actorRole: 'REQUESTER',
        },
      }),
    ]);
    this.realtime.emitTaskStatus(taskId, 'PUBLISHED');

    // Hand off to the background matching pipeline. Best-effort: if Redis is
    // down at this exact moment, the task still stays PUBLISHED and visible
    // in the worker feed (findNearbyTasks) — see MatchingQueue's own comment
    // on why a stalled matching pipeline degrades rather than hides the task.
    await this.matchingQueue.scheduleTier(taskId, 0, 0);

    this.logger.log(`Task ${taskId} published; matching started in the background.`);
    return this.getById(taskId, requesterId);
  }

  async cancel(taskId: string, requesterId: string, reason: string) {
    const task = await this.requireOwnedTask(taskId, requesterId);

    if (ACTIVE_WORK_STATUSES.includes(task.status)) {
      throw new BusinessRuleError(
        'Cancelling after a worker has been assigned is not available in this build yet. ' +
          'The compensation rate for the worker is an open business decision — see ai/memory.md.',
      );
    }

    assertTransitionAllowed(task.status, 'CANCELLED', 'REQUESTER');

    const payment = await this.prisma.payment.findUnique({ where: { taskId } });

    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason },
      });
      await tx.taskStatusHistory.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: 'CANCELLED',
          actorUserId: requesterId,
          actorRole: 'REQUESTER',
          reason,
        },
      });
    });
    this.realtime.emitTaskStatus(taskId, 'CANCELLED');

    if (payment && payment.status === 'CAPTURED') {
      await this.payments.refundFull(taskId);
    }

    return this.getById(taskId, requesterId);
  }

  /**
   * Expiry: the deadline passed and nobody accepted. Called by the sweeper's
   * deadline-expiry sweep (sweeper.service.ts), not by any user-facing
   * endpoint. Idempotent by the same construction as ReviewService.autoApprove
   * — if the task has already been accepted, cancelled or otherwise left
   * PUBLISHED/MATCHING, this is a silent no-op, which is what lets the
   * sweeper act on a task without coordinating with anything else that might
   * change it in the same instant. See docs/10-matching-engine.md's failure
   * modes table.
   *
   * There is deliberately no BullMQ fast path for expiry the way there is for
   * auto-approval: being caught within the sweeper's 60-second tick is fine
   * here, since nobody is watching a countdown the way a worker waits on
   * being paid. Duplicating the fast-path/guarantee pair for a case with no
   * latency sensitivity would be complexity without a real benefit.
   */
  async expireIfDue(taskId: string): Promise<{ acted: boolean }> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return { acted: false };
    if (task.assignedWorkerId) return { acted: false };

    const check = checkTransition(task.status, 'EXPIRED', 'SYSTEM');
    if (!check.allowed) return { acted: false };

    await this.prisma.$transaction([
      this.prisma.task.update({ where: { id: taskId }, data: { status: 'EXPIRED' } }),
      this.prisma.taskStatusHistory.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: 'EXPIRED',
          actorRole: 'SYSTEM',
          reason: 'Deadline passed with no worker accepted.',
        },
      }),
    ]);
    this.realtime.emitTaskStatus(taskId, 'EXPIRED');

    await this.matchingQueue.cancelPending(taskId);

    const payment = await this.prisma.payment.findUnique({ where: { taskId } });
    if (payment && payment.status === 'CAPTURED') {
      await this.payments.refundFull(taskId);
    }

    try {
      await this.notifications.notify(task.requesterId, {
        event: 'TASK_EXPIRED_REFUNDED',
        taskId,
        taskTitle: task.title,
        refundPaise: Number(task.budgetPaise),
      });
    } catch (error) {
      this.logger.warn(`Notification dispatch failed for task ${taskId} expiry: ${String(error)}`);
    }

    this.logger.log(`Task ${taskId} expired with no acceptance; refunded.`);
    return { acted: true };
  }

  // ─── Acceptance ──────────────────────────────────────────────────────

  /**
   * Eligibility is checked first, against a snapshot read. The actual
   * race-safety guarantee comes entirely from the atomic conditional update
   * below — a single UPDATE ... WHERE statement, which Postgres executes
   * atomically. Concurrent accepts serialize on the row; only the first to
   * commit sees its WHERE clause match, and every later one naturally affects
   * zero rows. No advisory lock, no SELECT FOR UPDATE, no application-level
   * check-then-act window. See docs/06-database-design.md.
   */
  async accept(taskId: string, workerId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task not found.');
    if (task.requesterId === workerId) {
      throw new ForbiddenError('You cannot accept your own task.');
    }

    // Defense in depth: MatchingService already excludes a blocked worker
    // from formal offers, but the worker feed (findNearbyTasks) is
    // independent of offer state by design (see ai/memory.md), so a blocked
    // worker could still find this task by browsing and try to accept it
    // directly. docs/12-trust-safety.md: blocking is "mutual exclusion from
    // matching, permanently."
    if (await this.safety.isBlocked(task.requesterId, workerId)) {
      throw new ForbiddenError('You cannot accept this task.');
    }

    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId: workerId },
      include: { categories: true },
    });
    if (!profile) throw new NotFoundError('Create a worker profile before accepting tasks.');
    if (!profile.isAvailable) {
      throw new BusinessRuleError('Set your availability on before accepting tasks.');
    }
    if (!profile.categories.some((c) => c.categoryId === task.categoryId)) {
      throw new BusinessRuleError('This task is outside your selected categories.');
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: workerId } });
    if (user.verificationLevel < task.minVerificationLevel) {
      throw new ForbiddenError(
        `This task requires verification level ${task.minVerificationLevel}. Complete verification to accept it.`,
      );
    }

    const check = checkTransition(task.status, 'ASSIGNED', 'WORKER', { hasAssignedWorker: false });
    if (!check.allowed) {
      throw new ConflictError(check.reason ?? 'This task cannot be accepted right now.');
    }

    // THE atomic operation. Prisma issues this as a single UPDATE ... WHERE
    // statement; count === 0 means another worker won the race between our
    // read above and this write.
    const result = await this.prisma.task.updateMany({
      where: { id: taskId, status: { in: ['PUBLISHED', 'MATCHING'] }, assignedWorkerId: null },
      data: { status: 'ASSIGNED', assignedWorkerId: workerId, assignedAt: new Date() },
    });

    if (result.count === 0) {
      throw new ConflictError('Another worker accepted this task first.');
    }

    // Best-effort: a pending tier-expansion job left in Redis after this
    // would only ever run into the "already assigned" no-op guard in
    // MatchingService.runTierPass, but there is no reason to leave it ticking.
    await this.matchingQueue.cancelPending(taskId);

    await this.prisma.$transaction([
      this.prisma.taskStatusHistory.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: 'ASSIGNED',
          actorUserId: workerId,
          actorRole: 'WORKER',
        },
      }),
      this.prisma.workerProfile.update({
        where: { userId: workerId },
        data: { tasksAccepted: { increment: 1 }, lastActiveAt: new Date() },
      }),
    ]);
    this.realtime.emitTaskStatus(taskId, 'ASSIGNED');

    try {
      await this.notifications.notify(task.requesterId, {
        event: 'WORKER_ASSIGNED',
        taskId,
        taskTitle: task.title,
        workerName: user.displayName,
      });
    } catch (error) {
      this.logger.warn(`Notification dispatch failed for task ${taskId} assignment: ${String(error)}`);
    }

    this.logger.log(`Task ${taskId} accepted by worker ${workerId}.`);
    return this.getById(taskId, workerId);
  }

  /**
   * Records an explicit decline on a formal offer, per docs/07's "Records a
   * decline and reason" and docs/10's "repeated declines on a task | flag
   * for operations" (the budget/instructions signal that surfaces through
   * `AdminService.getDashboardMetrics`'s existing `taskOffer.groupBy(by:
   * ['response'])` query, unused until now for the same reason this route
   * was — nothing ever wrote to `TaskOffer.response`).
   *
   * Deliberately scoped to workers who were actually offered this task: the
   * `TaskOffer` row already carries real, matching-engine-computed rank,
   * score and distance (see that model's own comment on why it exists —
   * "what makes ranking auditable"), and fabricating one for a worker who
   * merely browsed the open feed without ever being offered would corrupt
   * that audit trail with data the matching engine never actually produced.
   * A worker who was never offered has nothing to decline; they simply
   * don't accept, exactly as already works today.
   */
  async decline(taskId: string, workerId: string, input: DeclineTaskInput) {
    const offer = await this.prisma.taskOffer.findUnique({
      where: { taskId_workerId: { taskId, workerId } },
    });
    if (!offer) {
      throw new NotFoundError('You have not been offered this task.');
    }
    if (offer.response) {
      throw new ConflictError('You have already responded to this offer.');
    }

    await this.prisma.taskOffer.update({
      where: { id: offer.id },
      data: {
        response: 'DECLINED',
        declineReason: input.note ? `${input.reason}: ${input.note}` : input.reason,
        respondedAt: new Date(),
      },
    });

    this.logger.log(`Task ${taskId} declined by worker ${workerId} (${input.reason}).`);
  }

  // ─── Retrieval, role-projected ───────────────────────────────────────

  async listMine(userId: string, limit: number, cursor?: string, perspective: 'requester' | 'worker' = 'requester') {
    const cursorData = cursor ? decodeCursor<{ createdAt: string; id: string }>(cursor) : null;
    const ownerFilter = perspective === 'worker' ? { assignedWorkerId: userId } : { requesterId: userId };

    const tasks = await this.prisma.task.findMany({
      where: {
        ...ownerFilter,
        ...(cursorData && {
          OR: [
            { createdAt: { lt: new Date(cursorData.createdAt) } },
            { createdAt: new Date(cursorData.createdAt), id: { lt: cursorData.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { category: true },
    });

    const hasMore = tasks.length > limit;
    const page = tasks.slice(0, limit);
    const last = page.at(-1);

    return {
      data: page.map((t) => ({
        id: t.id,
        title: t.title,
        categorySlug: t.category.slug,
        status: t.status,
        budgetPaise: Number(t.budgetPaise),
        deadlineAt: t.deadlineAt.toISOString(),
        createdAt: t.createdAt.toISOString(),
      })),
      nextCursor:
        hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    };
  }

  /**
   * Returns the projection appropriate to the caller's relationship to the
   * task. Everyone else gets NotFoundError — existence of a task they have no
   * relationship to is not information they need. See
   * docs/07-api-specification.md's role-dependent projection table.
   */
  async getById(taskId: string, currentUserId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        category: true,
        requester: true,
        assignedWorker: { include: { workerProfile: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!task) throw new NotFoundError('Task not found.');

    const isOwner = task.requesterId === currentUserId;
    const isAssignedWorker = task.assignedWorkerId === currentUserId;

    if (!isOwner && !isAssignedWorker) {
      throw new NotFoundError('Task not found.');
    }

    const base = {
      id: task.id,
      title: task.title,
      description: task.description,
      categorySlug: task.category.slug,
      categoryName: task.category.name,
      status: task.status,
      deadlineAt: task.deadlineAt.toISOString(),
      reviewDeadlineAt: task.reviewDeadlineAt?.toISOString() ?? null,
      proofRequirements: task.proofRequirements,
      riskLevel: task.riskLevel,
      createdAt: task.createdAt.toISOString(),
      statusHistory: task.statusHistory.map((h) => ({
        status: h.toStatus,
        at: h.createdAt.toISOString(),
        actorRole: h.actorRole,
        reason: h.reason,
      })),
    };

    if (isOwner) {
      return {
        ...base,
        location: { latitude: task.taskLat, longitude: task.taskLng, address: task.taskAddress },
        money: {
          budgetPaise: Number(task.budgetPaise),
          commissionPaise: Number(task.commissionPaise),
          workerPayoutPaise: Number(task.workerPayoutPaise),
        },
        assignedWorker: task.assignedWorker
          ? {
              id: task.assignedWorker.id,
              displayName: task.assignedWorker.displayName,
              verificationLevel: task.assignedWorker.verificationLevel,
              ratingAvg: task.assignedWorker.workerProfile?.ratingAvg ?? null,
              tasksCompleted: task.assignedWorker.workerProfile?.tasksCompleted ?? 0,
            }
          : null,
      };
    }

    // Assigned worker's view: exact location once assigned, only the payout
    // (never the budget or commission), and the requester's public identity
    // only. See docs/07-api-specification.md.
    return {
      ...base,
      location: { latitude: task.taskLat, longitude: task.taskLng, address: task.taskAddress },
      payoutPaise: Number(task.workerPayoutPaise),
      requester: {
        displayName: task.requester.displayName,
        verificationLevel: task.requester.verificationLevel,
      },
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private async requireOwnedTask(taskId: string, requesterId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task not found.');
    if (task.requesterId !== requesterId) throw new NotFoundError('Task not found.');
    return task;
  }
}

/**
 * Reduces a full street address to its locality, so a worker browsing the feed
 * learns roughly where a task is without learning exactly where until they
 * accept it.
 */
function approximate(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length <= 2 ? address : parts.slice(-2).join(', ');
}
