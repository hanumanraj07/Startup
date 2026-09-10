import { Injectable, Logger } from '@nestjs/common';
import { formatDistance } from '@onsite/utils';
import { loadEnv } from '../../config/env';
import { GeoRepository } from '../../repositories/geo.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingQueue } from '../../queue/matching.queue';
import { NotificationService } from '../notifications/notification.service';
import { SafetyService } from '../safety/safety.service';
import { assertTransitionAllowed } from '../tasks/transitions';
import {
  MIN_RATINGS_FOR_OWN_SCORE,
  compareCandidates,
  scoreCandidate,
  type PlatformMeans,
} from './scoring';
import { computeTierDelayMs, offerCountForTier } from './tiers';

/**
 * Neutral launch-day fallbacks for the platform-mean components of the score,
 * used only until enough workers exist with real history
 * (`ratingCount >= MIN_RATINGS_FOR_OWN_SCORE`) for a real average to exist.
 * On day one nobody has history, so every candidate gets the same values here
 * and ranking is decided by proximity, category experience and recency
 * instead — which is the correct behaviour, not a bug. These numbers
 * self-correct: the moment real averages exist, `getPlatformMeans` returns
 * them instead.
 */
const DEFAULT_MEAN_RATING = 4.0;
const DEFAULT_MEAN_COMPLETION_RATE = 80;
const DEFAULT_MEAN_RESPONSE_RATE = 70;

/**
 * Bounds how many candidates a single tier pass pulls from the database
 * before scoring. The tier's own offer count (10/15/25/all) trims further;
 * this just stops a dense final tier in a large city from pulling every
 * eligible worker into memory at once.
 */
const CANDIDATE_QUERY_LIMIT = 300;

export interface TierPassResult {
  acted: boolean;
  offered: number;
}

/**
 * The matching pipeline: filter, score, offer, and schedule the next tier.
 * Runs entirely in the background worker process (main.ts's `ROLE=worker`
 * branch, via matching.worker.ts) — never inside the request that published
 * the task. See docs/10-matching-engine.md.
 *
 * `runTierPass` is idempotent in the same sense as ReviewService.autoApprove:
 * if the task has moved on (assigned, cancelled, expired) by the time a
 * scheduled job runs, this is a silent no-op. That is what lets a stale or
 * duplicate tier job never corrupt state, without any coordination with
 * whoever changed the task.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoRepository,
    private readonly queue: MatchingQueue,
    private readonly notifications: NotificationService,
    private readonly safety: SafetyService,
  ) {}

  async runTierPass(taskId: string, tierIndex: number): Promise<TierPassResult> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return { acted: false, offered: 0 };
    if (task.assignedWorkerId || (task.status !== 'PUBLISHED' && task.status !== 'MATCHING')) {
      return { acted: false, offered: 0 };
    }

    const env = loadEnv();
    const radii = env.MATCH_TIER_RADII_M;
    const waits = env.MATCH_TIER_WAIT_MINUTES;
    const lastTierIndex = radii.length - 1;
    const clampedTier = Math.min(Math.max(tierIndex, 0), lastTierIndex);
    const radiusMeters = radii[clampedTier];
    if (radiusMeters === undefined) {
      // Cannot happen in practice: clampedTier is clamped into
      // [0, radii.length - 1], and env.ts's zod schema refuses to boot with
      // an empty MATCH_TIER_RADII_M. Refusing loudly here rather than
      // silently defaulting keeps that invariant visible if it is ever
      // violated by a future config change.
      throw new Error(`No configured radius for matching tier ${clampedTier}.`);
    }
    const isLastTier = clampedTier >= lastTierIndex;

    // The PUBLISHED -> MATCHING transition, now genuinely driven by the
    // background worker starting the first tier pass rather than done
    // synchronously inline in the request (the Phase 4-era stub this
    // replaces — see ai/memory.md).
    if (task.status === 'PUBLISHED') {
      assertTransitionAllowed(task.status, 'MATCHING', 'SYSTEM');
      await this.prisma.$transaction([
        this.prisma.task.update({ where: { id: taskId }, data: { status: 'MATCHING' } }),
        this.prisma.taskStatusHistory.create({
          data: {
            taskId,
            fromStatus: 'PUBLISHED',
            toStatus: 'MATCHING',
            actorRole: 'SYSTEM',
            reason: `Matching tier ${clampedTier + 1} started.`,
          },
        }),
      ]);
    }

    const [alreadyOffered, blockedUserIds] = await Promise.all([
      this.prisma.taskOffer.findMany({ where: { taskId }, select: { workerId: true } }),
      this.safety.getBlockedUserIds(task.requesterId),
    ]);
    // "Not blocked: neither party has blocked the other." docs/10-matching-engine.md's filter table.
    const excludeUserIds = [task.requesterId, ...alreadyOffered.map((o) => o.workerId), ...blockedUserIds];

    const candidates = await this.geo.findNearbyWorkers({
      taskLat: task.taskLat,
      taskLng: task.taskLng,
      radiusMeters,
      minVerificationLevel: task.minVerificationLevel,
      categoryId: task.categoryId,
      excludeUserIds,
      maxConcurrentTasks: env.MAX_CONCURRENT_TASKS_PER_WORKER,
      limit: CANDIDATE_QUERY_LIMIT,
    });

    if (candidates.length === 0) {
      await this.prisma.task.update({ where: { id: taskId }, data: { currentRadiusMeters: radiusMeters } });

      if (!isLastTier) {
        // "No eligible workers at all -> expand to the final tier
        // immediately, alert operations." docs/10's failure-modes table.
        // There is no operations-alerting channel built yet (Phase 10); the
        // warn-level log is the honest extent of "alert" today.
        this.logger.warn(
          `Task ${taskId}: no eligible workers at tier ${clampedTier + 1} (${radiusMeters}m). Expanding straight to the final tier.`,
        );
        await this.queue.scheduleTier(taskId, lastTierIndex, 0);
      } else {
        this.logger.warn(
          `Task ${taskId}: no eligible workers even at the final tier (${radiusMeters}m). This signals a supply gap; the task will expire and refund at its deadline if nobody accepts.`,
        );
      }
      return { acted: true, offered: 0 };
    }

    const platformMeans = await this.getPlatformMeans();
    const now = new Date();

    const scored = candidates
      .map((c) => ({
        ...c,
        score: scoreCandidate(
          {
            distanceMeters: c.distanceMeters,
            ratingAvg: c.ratingAvg,
            ratingCount: c.ratingCount,
            completionRate: c.completionRate,
            categoryTasksCompleted: c.categoryTasksCompleted,
            responseRate: c.responseRate,
            tasksCompleted: c.tasksCompleted,
            lastActiveAt: c.lastActiveAt,
          },
          { tierRadiusMeters: radiusMeters, platformMeans, now, isNearestTier: clampedTier === 0 },
        ).total,
      }))
      .sort(compareCandidates);

    const offerCount = offerCountForTier(clampedTier);
    const chosen = Number.isFinite(offerCount) ? scored.slice(0, offerCount) : scored;

    await this.prisma.$transaction([
      this.prisma.taskOffer.createMany({
        data: chosen.map((c, i) => ({
          taskId,
          workerId: c.userId,
          rank: i + 1,
          score: c.score,
          distanceMeters: c.distanceMeters,
          radiusTierMeters: radiusMeters,
        })),
        skipDuplicates: true,
      }),
      this.prisma.workerProfile.updateMany({
        where: { userId: { in: chosen.map((c) => c.userId) } },
        data: { tasksOffered: { increment: 1 } },
      }),
      this.prisma.task.update({ where: { id: taskId }, data: { currentRadiusMeters: radiusMeters } }),
    ]);

    this.logger.log(
      `Task ${taskId}: tier ${clampedTier + 1} offered to ${chosen.length} worker(s) within ${radiusMeters}m.`,
    );

    // One notification per offered worker, immediately. docs/13 asks for
    // these to be batched into a single digest when several tasks match a
    // worker within a 10-minute window — that needs its own delayed
    // aggregation job and is a documented, honest gap (see TODO.md):
    // sending one immediate notification per match is correct, just not yet
    // as considerate of notification volume as the spec ultimately wants.
    await Promise.all(
      chosen.map((c) =>
        this.notifications
          .notify(c.userId, {
            event: 'NEW_TASK_NEARBY',
            taskId,
            taskTitle: task.title,
            payoutPaise: Number(task.workerPayoutPaise),
            distanceLabel: formatDistance(c.distanceMeters),
          })
          .catch((error) => this.logger.warn(`Notification dispatch failed for offer to ${c.userId}: ${String(error)}`)),
      ),
    );

    if (!isLastTier) {
      const delayMs = computeTierDelayMs({
        tierIndex: clampedTier,
        waitMinutes: waits,
        deadlineAt: task.deadlineAt,
        now,
      });
      await this.queue.scheduleTier(taskId, clampedTier + 1, delayMs);
    }

    return { acted: true, offered: chosen.length };
  }

  /**
   * The mean of rating, completion rate and response rate among workers with
   * enough history to trust their own numbers. Feeds the cold-start fallback
   * in scoring.ts. Computed fresh per tier pass rather than cached: it is one
   * cheap aggregate query, and caching it risks scoring against a stale
   * platform mean after a busy day shifts it.
   */
  private async getPlatformMeans(): Promise<PlatformMeans> {
    const means = await this.prisma.workerProfile.aggregate({
      _avg: { ratingAvg: true, completionRate: true, responseRate: true },
      where: { ratingCount: { gte: MIN_RATINGS_FOR_OWN_SCORE } },
    });
    return {
      ratingAvg: means._avg.ratingAvg ?? DEFAULT_MEAN_RATING,
      completionRate: means._avg.completionRate ?? DEFAULT_MEAN_COMPLETION_RATE,
      responseRate: means._avg.responseRate ?? DEFAULT_MEAN_RESPONSE_RATE,
    };
  }
}
