import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createBullConnection } from './redis-connection';

export const MATCHING_QUEUE_NAME = 'task-matching';
export const MATCHING_JOB_NAME = 'match-tier';

export interface MatchingJobData {
  taskId: string;
  tierIndex: number;
}

/**
 * One job id per (task, tier) pair — NOT one per task. This was tried first
 * and broke on the very first live run: the tier-N job schedules tier N+1
 * from inside its OWN processor, while it is still the currently-executing
 * job. Reusing one job id per task meant that add call collided with the job
 * that was mid-flight, and the instant that job's handler returned, BullMQ's
 * `removeOnComplete` deleted the Redis key it was stored under — which by
 * then held the freshly-added tier N+1 job, since both used the identical
 * id. The tier-1 offer would fire correctly and then silently vanish with no
 * tier-2 ever running. A generous, cheap sweep in `cancelPending` covers
 * every tier a task could possibly be at, so this is a safe trade for never
 * colliding with a job that is scheduling its own successor. See
 * ai/memory.md. The double dash, not a colon, is unrelated but still
 * deliberate — see auto-approve.queue.ts's note on the BullMQ bug that bit
 * this codebase's other delayed queue.
 */
function jobIdFor(taskId: string, tierIndex: number): string {
  return `${MATCHING_JOB_NAME}--${taskId}--${tierIndex}`;
}

/**
 * An upper bound on how many radius tiers a deployment could plausibly
 * configure, used only to know how many (task, tier) job ids `cancelPending`
 * needs to sweep. Real configurations have 3-5 tiers; this is generous
 * headroom, not a limit enforced anywhere else. Removing a job id that was
 * never used is a harmless no-op.
 */
const MAX_PLAUSIBLE_TIERS = 10;

/**
 * The producer side of the matching pipeline's radius expansion: schedules
 * (or reschedules) the next tier pass for a task.
 *
 * Unlike the auto-approve queue, there is no database-backed guarantee behind
 * this one specifically — building a second sweeper here would be
 * duplicating the auto-approve design for a lower-stakes failure. If Redis is
 * down and a scheduled tier pass never runs, the task is not lost: it stays
 * PUBLISHED, which the worker feed (`findNearbyTasks`, built in Phase 4)
 * already shows to every eligible nearby worker regardless of tier or offer
 * state, and it is still reclaimed by the ordinary deadline-expiry sweep in
 * sweeper.service.ts. A stalled matching pipeline degrades to "found by
 * browsing, not by notification" — not to "invisible". See ai/memory.md.
 */
@Injectable()
export class MatchingQueue implements OnModuleDestroy {
  private readonly logger = new Logger(MatchingQueue.name);
  private readonly queue = new Queue<MatchingJobData>(MATCHING_QUEUE_NAME, {
    connection: createBullConnection(),
  });

  async scheduleTier(taskId: string, tierIndex: number, delayMs: number): Promise<void> {
    const jobId = jobIdFor(taskId, tierIndex);
    try {
      // No queue.remove() before adding, unlike AutoApproveQueue.schedule:
      // each tier owns a distinct id, so there is nothing of this task's to
      // replace at this specific tier. (A resubmitted/duplicate schedule
      // call for the same tier would throw "Job already exists", which is
      // caught and logged below rather than left to crash the caller.)
      await this.queue.add(
        MATCHING_JOB_NAME,
        { taskId, tierIndex },
        { jobId, delay: Math.max(delayMs, 0), removeOnComplete: true, removeOnFail: true },
      );
    } catch (error) {
      this.logger.warn(
        `Could not schedule tier ${tierIndex} matching for task ${taskId}; it will still be found via the worker feed and reclaimed at its deadline if nobody accepts. ${String(error)}`,
      );
    }
  }

  /**
   * Best-effort cleanup once a task is assigned or otherwise leaves matching,
   * so a stale expansion doesn't fire a no-op later. Sweeps every tier id a
   * task could plausibly have pending — there is no single "the" pending job
   * id per task any more (see jobIdFor's comment), so cleanup means removing
   * across the whole plausible range rather than one known id.
   */
  async cancelPending(taskId: string): Promise<void> {
    try {
      await Promise.all(
        Array.from({ length: MAX_PLAUSIBLE_TIERS }, (_, tierIndex) =>
          this.queue.remove(jobIdFor(taskId, tierIndex)),
        ),
      );
    } catch (error) {
      this.logger.warn(`Could not cancel pending matching for task ${taskId}: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
