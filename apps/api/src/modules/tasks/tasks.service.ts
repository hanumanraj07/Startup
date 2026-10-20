import { Injectable, Logger } from '@nestjs/common';
import type { LocationMode, TaskStatus } from '@prisma/client';
import type {
  CreateTaskInput,
  DeclineTaskInput,
  LeaveTaskInput,
  NearbyTasksInput,
  RemoveWorkerInput,
  UpdateTaskInput,
} from '@onsite/validation';
import { calculateItemSettlement, calculateSplit, cashPurchaseCapPaise, requesterTotal } from '@onsite/money';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { ACTIVE_WORK_STATUSES } from '@onsite/types';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors';
import { approximateAddress, categoryLabel } from '../../common/projections';
import { loadEnv, payoutProvider } from '../../config/env';
import { GeoRepository, isWithinIndiaBounds } from '../../repositories/geo.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingQueue } from '../../queue/matching.queue';
import { ModerationService, type ModerationStage } from '../moderation/moderation.service';
import { NotificationService } from '../notifications/notification.service';
import { OffersService } from '../matching/offers.service';
import { LiveLocationService } from '../realtime/live-location.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { SafetyService } from '../safety/safety.service';
import { assertTransitionAllowed, checkTransition, REMOVABLE_BEFORE_ARRIVAL } from './transitions';
import { RiskService } from './risk.service';
import { PaymentsService } from '../payments/payments.service';

/** How many times a requester may remove a worker from one task before only cancel or report remain. */
const MAX_REMOVALS_PER_TASK = 3;

/** Plain words for the timeline; the enum value itself is kept on the release record. */
const RELEASE_REASON_LABEL: Record<string, string> = {
  CANT_REACH_LOCATION: 'could not reach the location',
  PERSONAL_EMERGENCY: 'personal emergency',
  TASK_NOT_AS_DESCRIBED: 'task not as described',
  SAFETY_CONCERN: 'safety concern',
  NOT_RESPONDING: 'worker not responding',
  TOO_SLOW: 'taking too long to arrive',
  OTHER: 'other',
};

/** Below this the "drop-off" is the pickup, give or take GPS noise. */
const MIN_DELIVERY_DISTANCE_M = 50;

/**
 * P3 added this receipt photo to every task with an item budget. Since P6
 * the bill photo is part of the bill the requester approves before anything
 * is bought, so it is no longer a proof requirement and is stripped from
 * requirements a client sends.
 */
const ITEM_RECEIPT_FIELD_KEY = 'item_receipt';

interface DropoffColumns {
  dropoffLat: number | null;
  dropoffLng: number | null;
  dropoffAddress: string | null;
  dropoffPlaceName: string | null;
}

export interface FeedItem {
  id: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  distanceMeters: number;
  payoutPaise: number;
  /** The most the worker would spend on an item and get back, or 0. Not earnings. */
  itemBudgetPaise: number;
  deadlineAt: string;
  approximateAddress: string;
  /** Pickup & delivery tasks only: roughly where it goes, and how far. The exact drop-off is revealed on acceptance. */
  dropoff: { approximateAddress: string; tripDistanceMeters: number } | null;
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
    private readonly moderation: ModerationService,
    private readonly offers: OffersService,
    private readonly publisher: RealtimePublisher,
    private readonly live: LiveLocationService,
  ) {}

  /**
   * Moderation for every task write: the posting cooldown, the keyword rules
   * and, when configured, the OpenAI check. A block is recorded (moderation
   * event + audit row) before it is thrown — a blocked attempt is a trust &
   * safety signal, not just an error the client absorbs. See
   * moderation.service.ts and ai/memory.md, 2026-09-24 and 2026-10-18.
   */
  private async screenContent(
    requesterId: string,
    stage: ModerationStage,
    title: string,
    description: string,
    actorIp: string | undefined,
    taskId?: string,
  ): Promise<void> {
    await this.moderation.screenTask({
      userId: requesterId,
      stage,
      title,
      description,
      ruleReason: this.risk.findProhibitedMatch(title, description),
      taskId,
      actorIp,
    });
  }

  // ─── Discovery ───────────────────────────────────────────────────────

  /**
   * The worker feed. Runs the PostGIS radius search and returns open tasks
   * nearest first. Distance is measured server-side; the client never
   * calculates it and is never believed about it.
   */
  async findNearby(query: NearbyTasksInput, currentUserId: string, verificationLevel: number): Promise<FeedItem[]> {
    // Measured from the worker's saved base and working radius, never from
    // anything in the request: a client-supplied point and radius let anyone
    // browse tasks anywhere in India. See nearbyTasksSchema's comment.
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId: currentUserId },
      select: { baseLat: true, baseLng: true, workingRadiusMeters: true },
    });
    if (!profile) return [];
    const { baseLat: latitude, baseLng: longitude, workingRadiusMeters } = profile;

    const categories = await this.prisma.category.findMany({
      where: { isActive: true, ...(query.categorySlug ? { slug: query.categorySlug } : {}) },
      select: { id: true, slug: true, name: true },
    });
    if (categories.length === 0) return [];

    // Tasks this worker left or was removed from never come back to them.
    const released = await this.prisma.taskRelease.findMany({
      where: { workerId: currentUserId },
      select: { taskId: true },
    });

    const nearby = await this.geo.findNearbyTasks({
      workerLat: latitude,
      workerLng: longitude,
      radiusMeters: workingRadiusMeters,
      verificationLevel,
      categoryIds: categories.map((c) => c.id),
      excludeRequesterIds: [currentUserId],
      excludeTaskIds: released.map((r) => r.taskId),
      limit: query.limit,
      offset: 0,
    });
    if (nearby.length === 0) return [];

    const distanceById = new Map(nearby.map((t) => [t.id, t.distanceMeters]));
    const tripById = new Map(nearby.map((t) => [t.id, t.tripDistanceMeters]));

    const tasks = await this.prisma.task.findMany({
      where: { id: { in: nearby.map((t) => t.id) } },
      select: {
        id: true,
        title: true,
        taskAddress: true,
        dropoffAddress: true,
        deadlineAt: true,
        workerPayoutPaise: true,
        itemBudgetPaise: true,
        customCategoryLabel: true,
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
        categoryName: categoryLabel(t.category, t.customCategoryLabel),
        distanceMeters: distanceById.get(t.id) ?? 0,
        payoutPaise: Number(t.workerPayoutPaise),
        itemBudgetPaise: Number(t.itemBudgetPaise),
        deadlineAt: t.deadlineAt.toISOString(),
        approximateAddress: approximateAddress(t.taskAddress),
        dropoff: t.dropoffAddress
          ? { approximateAddress: approximateAddress(t.dropoffAddress), tripDistanceMeters: tripById.get(t.id) ?? 0 }
          : null,
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
    const customCategoryLabel = resolveCustomLabel(category.slug, input.customCategoryLabel);
    await this.screenContent(requesterId, 'CREATE', input.title, withLabel(input.description, customCategoryLabel), actorIp);
    const dropoff = await this.resolveDropoff(category.locationMode, input.taskLocation, input, 'create');
    const itemBudgetPaise = resolveItemBudget(category.locationMode, input.itemBudgetPaise ?? 0);
    // Risk and the verification level follow everything at stake, item included.
    const atStakePaise = requesterTotal(input.budgetPaise, itemBudgetPaise);
    const riskResult = this.risk.scoreRisk({
      title: input.title,
      description: input.description,
      budgetPaise: atStakePaise,
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
        customCategoryLabel,
        status: 'DRAFT',
        taskLat: input.taskLocation.latitude,
        taskLng: input.taskLocation.longitude,
        taskAddress: input.taskAddress,
        taskPlaceName: input.taskPlaceName,
        taskPlaceId: input.taskPlaceId,
        ...dropoff,
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
        itemBudgetPaise,
        deadlineAt: input.deadlineAt,
        proofRequirements: withoutItemReceipt(input.proofRequirements) as object,
        minVerificationLevel: this.risk.minVerificationLevelForBudget(atStakePaise),
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

    // The price is frozen once payment has started (docs/22, #3). A payment
    // or an open gateway order covers the amount the draft had then; letting
    // the budget, the item budget or the category (which can drop the item
    // budget) change afterwards would publish a task worth more than escrow
    // holds. publish() checks the amounts match as well; this refuses early.
    if (input.budgetPaise !== undefined || input.itemBudgetPaise !== undefined || input.categorySlug !== undefined) {
      if (await this.payments.forTask(taskId)) {
        throw new BusinessRuleError(
          'Payment for this task has already started, so its price, item budget and category can no longer change. ' +
            'Cancel it for a full refund and post it again with the new details.',
        );
      }
    }

    // Content edits are re-screened; every edit, content or not, waits out
    // an active cooldown, so a blocked user cannot keep tweaking a draft.
    if (input.title || input.description || input.customCategoryLabel) {
      await this.screenContent(
        requesterId,
        'UPDATE',
        input.title ?? task.title,
        withLabel(input.description ?? task.description, input.customCategoryLabel ?? task.customCategoryLabel),
        actorIp,
        taskId,
      );
    } else {
      await this.moderation.assertNotRestricted(requesterId);
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
    let locationMode: LocationMode | null = null;
    let categorySlug: string | null = null;
    if (input.categorySlug) {
      const found = await this.prisma.category.findFirst({
        where: { slug: input.categorySlug, isActive: true },
      });
      if (!found) throw new NotFoundError('That category is not currently available.');
      category = found.id;
      locationMode = found.locationMode;
      categorySlug = found.slug;
    }
    // The custom label belongs to "Other" only: required there, cleared when
    // the task moves to a named category.
    let customCategoryLabel: string | null | undefined;
    if (input.categorySlug !== undefined || input.customCategoryLabel !== undefined) {
      const slug = categorySlug ?? (await this.prisma.category.findUniqueOrThrow({ where: { id: task.categoryId } })).slug;
      customCategoryLabel = resolveCustomLabel(slug, input.customCategoryLabel ?? task.customCategoryLabel ?? undefined);
    }

    // Re-check the drop-off whenever anything it depends on changes: the
    // category (which decides whether there is one), the pickup point, or
    // the drop-off itself.
    let dropoff: DropoffColumns | undefined;
    if (input.categorySlug !== undefined || input.taskLocation !== undefined || input.dropoffLocation !== undefined || input.dropoffAddress !== undefined) {
      const mode = locationMode ?? (await this.prisma.category.findUniqueOrThrow({ where: { id: task.categoryId } })).locationMode;
      const pickup = input.taskLocation ?? { latitude: task.taskLat, longitude: task.taskLng };
      const merged =
        input.dropoffLocation !== undefined || input.dropoffAddress !== undefined
          ? input
          : task.dropoffLat !== null && task.dropoffLng !== null && task.dropoffAddress !== null
            ? {
                dropoffLocation: { latitude: task.dropoffLat, longitude: task.dropoffLng },
                dropoffAddress: task.dropoffAddress,
                dropoffPlaceName: task.dropoffPlaceName ?? undefined,
              }
            : {};
      dropoff = await this.resolveDropoff(mode, pickup, merged, 'update');
    }

    // The item budget follows the category: switching to a one-place
    // category drops it, since a bought item has nowhere to be delivered.
    let itemBudgetPaise = Number(task.itemBudgetPaise);
    if (input.itemBudgetPaise !== undefined || input.categorySlug !== undefined) {
      const mode = locationMode ?? (await this.prisma.category.findUniqueOrThrow({ where: { id: task.categoryId } })).locationMode;
      itemBudgetPaise =
        input.itemBudgetPaise !== undefined
          ? resolveItemBudget(mode, input.itemBudgetPaise)
          : mode === 'SINGLE'
            ? 0
            : itemBudgetPaise;
    }
    const itemChanged = itemBudgetPaise !== Number(task.itemBudgetPaise);
    const proofRequirements =
      input.proofRequirements !== undefined || itemChanged
        ? withoutItemReceipt(
            (input.proofRequirements ?? (task.proofRequirements as unknown as ProofRequirementJson[])) as ProofRequirementJson[],
          )
        : undefined;
    const atStakePaise = requesterTotal(money?.budgetPaise ?? Number(task.budgetPaise), itemBudgetPaise);

    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.categorySlug !== undefined && { categoryId: category }),
        ...(customCategoryLabel !== undefined && { customCategoryLabel }),
        cityId,
        ...(input.taskLocation && {
          taskLat: input.taskLocation.latitude,
          taskLng: input.taskLocation.longitude,
        }),
        ...(input.taskAddress !== undefined && { taskAddress: input.taskAddress }),
        ...dropoff,
        ...(input.deadlineAt !== undefined && { deadlineAt: input.deadlineAt }),
        ...(proofRequirements !== undefined && { proofRequirements: proofRequirements as object }),
        ...(itemChanged && { itemBudgetPaise }),
        ...((money || itemChanged) && { minVerificationLevel: this.risk.minVerificationLevelForBudget(atStakePaise) }),
        ...(money && {
          budgetPaise: money.budgetPaise,
          commissionRateBps: money.commissionRateBps,
          commissionPaise: money.commissionPaise,
          gstPaise: money.gstPaise,
          tcsPaise: money.tcsPaise,
          tdsPaise: money.tdsPaise,
          workerPayoutPaise: money.workerPayoutPaise,
        }),
      },
    });

    return this.getById(taskId, requesterId);
  }

  /**
   * The drop-off columns for a task, checked against its category's mode.
   * One-location categories never carry a drop-off (on create it is refused;
   * on an edit that switches category it is cleared). Pickup & delivery
   * categories need one, inside India, measurably apart from the pickup and
   * within MAX_DELIVERY_DISTANCE_M of it — distance measured with PostGIS.
   */
  private async resolveDropoff(
    mode: LocationMode,
    pickup: { latitude: number; longitude: number },
    input: { dropoffLocation?: { latitude: number; longitude: number }; dropoffAddress?: string; dropoffPlaceName?: string },
    context: 'create' | 'update',
  ): Promise<DropoffColumns> {
    const none: DropoffColumns = { dropoffLat: null, dropoffLng: null, dropoffAddress: null, dropoffPlaceName: null };
    if (mode === 'SINGLE') {
      if (input.dropoffLocation && context === 'create') {
        throw new BusinessRuleError('This kind of task happens at one place, so it cannot have a drop-off.');
      }
      return none;
    }

    const { dropoffLocation, dropoffAddress } = input;
    if (!dropoffLocation || !dropoffAddress) {
      throw new BusinessRuleError('Add where the item should be delivered: a point on the map and an address.');
    }
    if (!isWithinIndiaBounds(dropoffLocation.latitude, dropoffLocation.longitude)) {
      throw new BusinessRuleError('The drop-off must be within India.');
    }
    const meters = await this.geo.distanceBetween(
      { lat: pickup.latitude, lng: pickup.longitude },
      { lat: dropoffLocation.latitude, lng: dropoffLocation.longitude },
    );
    if (!(meters >= MIN_DELIVERY_DISTANCE_M)) {
      throw new BusinessRuleError('The drop-off is the same place as the pickup. Choose where it should be delivered.');
    }
    const max = loadEnv().MAX_DELIVERY_DISTANCE_M;
    if (meters > max) {
      throw new BusinessRuleError(
        `Deliveries can be up to ${Math.round(max / 1000)} km from the pickup. This drop-off is ${(meters / 1000).toFixed(1)} km away.`,
      );
    }
    return {
      dropoffLat: dropoffLocation.latitude,
      dropoffLng: dropoffLocation.longitude,
      dropoffAddress,
      dropoffPlaceName: input.dropoffPlaceName ?? null,
    };
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
  async publish(taskId: string, requesterId: string, actorIp?: string) {
    const task = await this.requireOwnedTask(taskId, requesterId);

    // Re-checked at the gate that makes a task visible: the rules may have
    // tightened since the draft was written, and a cooldown applies here too.
    await this.screenContent(requesterId, 'PUBLISH', task.title, withLabel(task.description, task.customCategoryLabel), actorIp, taskId);

    if (task.riskLevel === 'HIGH') {
      throw new BusinessRuleError(
        'This task requires manual review before it can be published. Manual review is not available in this build yet — see docs/15-admin-panel.md for the intended flow.',
      );
    }
    if (task.deadlineAt.getTime() <= Date.now()) {
      throw new BusinessRuleError('This task\'s deadline has already passed. Update it before publishing.');
    }

    const payment = await this.payments.forTask(taskId);
    assertTransitionAllowed(task.status, 'PUBLISHED', 'REQUESTER', { paymentCaptured: payment?.status === 'CAPTURED' });

    // What was captured must be exactly what the task owes, never just "some
    // payment exists" (docs/22, #3). update() already refuses a price change
    // once payment starts; this catches anything that slipped past it.
    const owedPaise = requesterTotal(Number(task.budgetPaise), Number(task.itemBudgetPaise));
    if (Number(payment?.amountPaise) !== owedPaise) {
      this.logger.error(
        `Task ${taskId}: publish refused, captured ${String(payment?.amountPaise)} paise but the task owes ${owedPaise}.`,
      );
      throw new BusinessRuleError(
        'The payment held for this task does not match its price. Cancel it for a full refund and post it again.',
      );
    }

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
    this.publisher.taskStatus(taskId, 'PUBLISHED');

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
    this.publisher.taskStatus(taskId, 'CANCELLED');
    await this.matchingQueue.cancelPending(taskId);
    await this.offers.withdraw(taskId).catch(() => undefined);

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
    this.publisher.taskStatus(taskId, 'EXPIRED');

    await this.matchingQueue.cancelPending(taskId);
    await this.offers.withdraw(taskId).catch(() => undefined);

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

  /**
   * Repair for a task that reached EXPIRED or CANCELLED with its payment
   * still held: the status write committed and the refund after it never ran
   * (docs/22, #1: two expired tasks in production were never refunded).
   * Called by the sweeper's stranded-money sweep; refundFull claims the
   * payment atomically, so a second attempt is a no-op. An expired task's
   * requester was never told, so they are told now.
   */
  async refundStranded(taskId: string): Promise<{ acted: boolean }> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || (task.status !== 'EXPIRED' && task.status !== 'CANCELLED')) return { acted: false };

    const refunded = await this.payments.refundFull(taskId);
    if (!refunded) return { acted: false };

    if (task.status === 'EXPIRED') {
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
    }
    this.logger.warn(`Task ${taskId} was ${task.status} with its payment still held; refunded by the repair sweep.`);
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

    // A worker who left this task, or was removed from it, does not get it
    // back: the requester has already moved on, and re-accepting would let a
    // worker reset a task's clock or dodge the leave penalty.
    const released = await this.prisma.taskRelease.findFirst({ where: { taskId, workerId }, select: { id: true } });
    if (released) {
      throw new ForbiddenError('You have already been released from this task and cannot accept it again.');
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
    this.publisher.taskStatus(taskId, 'ASSIGNED');
    // Everyone else's request disappears at once, and the requester hears
    // about it wherever they are in the app, not only on the task page.
    await this.offers.closeForAssignment(taskId, workerId).catch((error) =>
      this.logger.warn(`Could not close offers for task ${taskId}: ${String(error)}`),
    );
    this.publisher.toUser(task.requesterId, 'task:assigned', { taskId, taskTitle: task.title, workerName: user.displayName });

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
    await this.offers.advanceIfWaveDone(taskId).catch((error) =>
      this.logger.warn(`Could not advance matching for task ${taskId}: ${String(error)}`),
    );
  }

  // ─── Releasing an assignment ─────────────────────────────────────────

  /**
   * The assigned worker gives the task up, at any point before submitting.
   * docs/09: "ASSIGNED … IN_PROGRESS → MATCHING (worker abandons, task
   * re-offered)". The completion rate takes the hit; the requester's money
   * stays held and the task goes straight back to matching.
   */
  async leave(taskId: string, workerId: string, input: LeaveTaskInput) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.assignedWorkerId !== workerId) throw new NotFoundError('Task not found.');
    assertTransitionAllowed(task.status, 'MATCHING', 'WORKER', { isAssignedWorker: true });
    // An approved bill means the item is being, or has been, bought with the
    // requester's money: walking away from it is not a leave, it is an issue.
    if ((await this.prisma.itemPurchase.count({ where: { taskId, status: 'APPROVED' } })) > 0) {
      throw new BusinessRuleError('The item bill is already approved, so you cannot leave this task. Use Report an issue.');
    }

    await this.releaseAssignment(task, workerId, 'WORKER', input.reason, input.note);

    const worker = await this.prisma.user.findUnique({ where: { id: workerId }, select: { displayName: true } });
    await this.notifySafely(task.requesterId, {
      event: 'WORKER_LEFT',
      taskId,
      taskTitle: task.title,
      workerName: worker?.displayName ?? 'Your worker',
    });
    return { status: 'MATCHING' as const };
  }

  /**
   * The requester hands the task to someone else, before the worker has
   * arrived. No money moves and the worker's completion rate is not
   * penalised — it was not their decision. Capped per task so a requester
   * cannot cycle through workers indefinitely; after that the options are
   * cancelling or reporting an issue.
   */
  async removeWorker(taskId: string, requesterId: string, input: RemoveWorkerInput) {
    const task = await this.requireOwnedTask(taskId, requesterId);
    if (!task.assignedWorkerId) throw new BusinessRuleError('No worker is assigned to this task.');
    if (!REMOVABLE_BEFORE_ARRIVAL.includes(task.status)) {
      throw new BusinessRuleError(
        'The worker has already arrived, so they can no longer be removed. If something is wrong, use Report an issue.',
      );
    }
    assertTransitionAllowed(task.status, 'MATCHING', 'REQUESTER');

    const removals = await this.prisma.taskRelease.count({ where: { taskId, initiatedBy: 'REQUESTER' } });
    if (removals >= MAX_REMOVALS_PER_TASK) {
      throw new BusinessRuleError(
        `You have already removed ${MAX_REMOVALS_PER_TASK} workers from this task. Cancel it or report an issue instead.`,
      );
    }

    const workerId = task.assignedWorkerId;
    await this.releaseAssignment(task, requesterId, 'REQUESTER', input.reason, input.note);
    await this.notifySafely(workerId, { event: 'WORKER_REMOVED', taskId, taskTitle: task.title });
    return this.getById(taskId, requesterId);
  }

  /**
   * The shared half of leave and remove. One transaction: the conditional
   * update (so a worker leaving and a requester removing at the same moment,
   * or either racing a status change, cannot both win), the release record,
   * the history row, discarding the released worker's uploaded proof — the
   * next worker starts clean and can never submit someone else's evidence —
   * and the worker's stats. Then matching restarts from the first tier.
   */
  private async releaseAssignment(
    task: { id: string; status: TaskStatus; assignedWorkerId: string | null },
    actorUserId: string,
    initiatedBy: 'WORKER' | 'REQUESTER',
    reason: string,
    note: string | undefined,
  ): Promise<void> {
    const workerId = task.assignedWorkerId;
    if (!workerId) throw new BusinessRuleError('No worker is assigned to this task.');

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: task.id, status: task.status, assignedWorkerId: workerId },
        data: { status: 'MATCHING', assignedWorkerId: null, assignedAt: null },
      });
      if (updated.count === 0) {
        throw new ConflictError('This task changed a moment ago. Refresh to see its current state.');
      }

      await tx.taskRelease.create({
        data: { taskId: task.id, workerId, initiatedBy, fromStatus: task.status, reason, note },
      });
      await tx.taskStatusHistory.create({
        data: {
          taskId: task.id,
          fromStatus: task.status,
          toStatus: 'MATCHING',
          actorUserId,
          actorRole: initiatedBy,
          reason:
            initiatedBy === 'WORKER'
              ? `Worker left the task: ${RELEASE_REASON_LABEL[reason] ?? reason}${note ? ` (${note})` : ''}.`
              : `Requester removed the worker: ${RELEASE_REASON_LABEL[reason] ?? reason}${note ? ` (${note})` : ''}.`,
        },
      });
      await tx.taskProof.deleteMany({ where: { taskId: task.id, workerId } });
      // An unanswered bill goes with the worker; the next one sends their own.
      await tx.itemPurchase.updateMany({
        where: { taskId: task.id, status: 'PENDING_APPROVAL', topUpCapturedAt: null },
        data: { status: 'CANCELLED', decidedAt: new Date() },
      });

      const profile = await tx.workerProfile.findUnique({ where: { userId: workerId } });
      if (profile) {
        // Leaving counts against the worker; being removed does not, so the
        // acceptance that is being undone is taken back out of the ratio.
        const tasksAccepted = initiatedBy === 'REQUESTER' ? Math.max(0, profile.tasksAccepted - 1) : profile.tasksAccepted;
        const tasksAbandoned = profile.tasksAbandoned + (initiatedBy === 'WORKER' ? 1 : 0);
        const completionRate =
          tasksAccepted > 0 ? Math.round((profile.tasksCompleted / tasksAccepted) * 1000) / 10 : null;
        await tx.workerProfile.update({
          where: { userId: workerId },
          data: { tasksAccepted, tasksAbandoned, completionRate },
        });
      }
    });

    this.publisher.taskStatus(task.id, 'MATCHING');
    this.publisher.removeUserFromTask(task.id, workerId);
    await this.live.end(task.id);
    await this.matchingQueue.scheduleTier(task.id, 0, 0);
    this.logger.log(`Task ${task.id}: worker ${workerId} released by ${initiatedBy.toLowerCase()} (${reason}); re-matching.`);
  }

  private async notifySafely(userId: string, payload: Parameters<NotificationService['notify']>[1]): Promise<void> {
    try {
      await this.notifications.notify(userId, payload);
    } catch (error) {
      this.logger.warn(`Notification dispatch failed (${payload.event}): ${String(error)}`);
    }
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
        // Each side sees only its own figure: the requester what they pay
        // in total, the worker what they earn. Never the gross task payment
        // to a worker, which with their earnings would reveal the commission.
        amountPaise:
          perspective === 'worker'
            ? Number(t.workerPayoutPaise)
            : requesterTotal(Number(t.budgetPaise), Number(t.itemBudgetPaise) + Number(t.itemTopUpPaise)),
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
      categoryName: categoryLabel(task.category, task.customCategoryLabel),
      customCategoryLabel: task.customCategoryLabel,
      locationMode: task.category.locationMode,
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
        dropoff: dropoffView(task),
        // While a worker is being found: how many have been sent the request
        // and how far out the search has reached. Counts only, no identities.
        matching:
          task.status === 'PUBLISHED' || task.status === 'MATCHING'
            ? {
                workersNotified: await this.prisma.taskOffer.count({ where: { taskId: task.id } }),
                radiusMeters: task.currentRadiusMeters,
              }
            : null,
        // What the requester pays, never how it divides: the platform's
        // commission and the worker's net earnings stay internal (founder
        // decision 2026-10-19, docs/11-payment-flow.md).
        money: requesterMoney(task),
        // The code the requester gives whoever receives the item. Never in
        // the worker's view: entering it is the worker's proof of handover.
        handover: task.handoverCode
          ? { code: task.handoverCode, confirmed: task.handoverConfirmedAt !== null }
          : null,
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
    // only. See docs/07-api-specification.md. An item budget is shown apart
    // from earnings: it is money the worker spends and gets back.
    return {
      ...base,
      location: { latitude: task.taskLat, longitude: task.taskLng, address: task.taskAddress },
      dropoff: dropoffView(task),
      payoutPaise: Number(task.workerPayoutPaise),
      item: itemView(task, task.assignedWorker?.verificationLevel ?? 0),
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
 * "Other" needs the requester's own description of the kind of task; every
 * named category refuses one, so a label can never mask a real category.
 */
function resolveCustomLabel(slug: string, label: string | undefined): string | null {
  if (slug === 'other') {
    if (!label?.trim()) throw new BusinessRuleError('Say what kind of task this is, for example "Stand in a queue".');
    return label.trim();
  }
  if (label?.trim()) throw new BusinessRuleError('Only an "Other" task takes a description of its kind.');
  return null;
}

/** The label is screened as part of the task text, so it cannot carry what the title may not. */
function withLabel(description: string, label: string | null | undefined): string {
  return label ? `${label}\n${description}` : description;
}

type ProofRequirementJson = { type: string; fieldKey?: string; label: string; required: boolean; minCount?: number };

/**
 * An item budget only makes sense when there is somewhere to deliver the
 * item, so it is refused on one-place categories rather than silently held.
 */
function resolveItemBudget(mode: LocationMode, itemBudgetPaise: number): number {
  if (itemBudgetPaise > 0 && mode === 'SINGLE') {
    throw new BusinessRuleError(
      'Buying an item is only possible on a pickup & delivery task, so the item can be brought to you.',
    );
  }
  return itemBudgetPaise;
}

/** The task's proof list without P3's receipt requirement (see ITEM_RECEIPT_FIELD_KEY). */
function withoutItemReceipt<T extends { fieldKey?: string }>(requirements: readonly T[]): T[] {
  return requirements.filter((r) => r.fieldKey !== ITEM_RECEIPT_FIELD_KEY);
}

/**
 * The requester's money: the task payment they set, the item budget, any
 * top-up they paid to approve a bill above it, and the total charged. Once
 * a bill is approved, what the item cost and what comes back. Commission and
 * worker earnings are deliberately absent.
 */
function requesterMoney(task: {
  budgetPaise: bigint;
  itemBudgetPaise: bigint;
  itemTopUpPaise: bigint;
  itemSpentPaise: bigint | null;
}) {
  const taskPaymentPaise = Number(task.budgetPaise);
  const itemBudgetPaise = Number(task.itemBudgetPaise);
  const itemTopUpPaise = Number(task.itemTopUpPaise);
  const settlement =
    task.itemSpentPaise !== null
      ? calculateItemSettlement(itemBudgetPaise + itemTopUpPaise, Number(task.itemSpentPaise))
      : null;
  return {
    taskPaymentPaise,
    itemBudgetPaise,
    itemTopUpPaise,
    totalPaise: requesterTotal(taskPaymentPaise, itemBudgetPaise + itemTopUpPaise),
    itemSpentPaise: settlement?.itemSpentPaise ?? null,
    itemRefundPaise: settlement?.refundPaise ?? null,
  };
}

/**
 * The item as the assigned worker sees it, or null when nothing is bought:
 * what is set aside (with any top-up), the approved bill, the most they may
 * pay in cash at their level, and whether the platform can pay a shop.
 */
function itemView(
  task: { itemBudgetPaise: bigint; itemTopUpPaise: bigint; itemSpentPaise: bigint | null; handoverConfirmedAt: Date | null },
  verificationLevel: number,
) {
  return Number(task.itemBudgetPaise) > 0
    ? {
        budgetPaise: Number(task.itemBudgetPaise) + Number(task.itemTopUpPaise),
        spentPaise: task.itemSpentPaise !== null ? Number(task.itemSpentPaise) : null,
        cashCapPaise: cashPurchaseCapPaise(verificationLevel),
        shopPaymentAvailable: payoutProvider() !== 'none',
        handoverConfirmed: task.handoverConfirmedAt !== null,
      }
    : null;
}

/** The exact drop-off, for the requester and the assigned worker only. */
function dropoffView(task: { dropoffLat: number | null; dropoffLng: number | null; dropoffAddress: string | null }) {
  return task.dropoffLat !== null && task.dropoffLng !== null && task.dropoffAddress !== null
    ? { latitude: task.dropoffLat, longitude: task.dropoffLng, address: task.dropoffAddress }
    : null;
}

