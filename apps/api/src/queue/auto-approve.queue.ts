import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createBullConnection } from './redis-connection';

export const AUTO_APPROVE_QUEUE_NAME = 'task-auto-approve';
export const AUTO_APPROVE_JOB_NAME = 'auto-approve';

/**
 * BullMQ rejects a colon in a custom job id ("Custom Id cannot contain :"),
 * since it uses colons itself as an internal key-namespacing separator. Found
 * live: the first real submission through this path logged
 * "Could not schedule the auto-approve queue job ... Custom Id cannot
 * contain :" and swallowed it exactly as designed — the task still submitted
 * successfully, and only the sweeper would have caught that particular task.
 * A double dash avoids the reserved character. See ai/memory.md.
 */
function jobIdFor(taskId: string): string {
  return `${AUTO_APPROVE_JOB_NAME}--${taskId}`;
}

export interface AutoApproveJobData {
  taskId: string;
}

/**
 * The producer side of the fast path: schedules a delayed job to auto-approve
 * a task at its review deadline. The job's id is deterministic per task
 * (`auto-approve:<taskId>`), which makes scheduling idempotent — resubmitting
 * after a rejection replaces any stale job rather than accumulating one per
 * submission.
 *
 * This is a convenience layer only. If Redis is unavailable when a task is
 * submitted, the submission itself must not fail — see `schedule`'s comment.
 * The database-backed sweeper (sweeper.service.ts) is what actually
 * guarantees a submitted task gets reviewed, with or without this queue.
 */
@Injectable()
export class AutoApproveQueue implements OnModuleDestroy {
  private readonly logger = new Logger(AutoApproveQueue.name);
  private readonly queue = new Queue<AutoApproveJobData>(AUTO_APPROVE_QUEUE_NAME, {
    connection: createBullConnection(),
  });

  /**
   * Schedules (or reschedules) the auto-approve job for a task.
   *
   * Failures here are swallowed rather than thrown: the review deadline
   * gate that actually matters lives in the database
   * (`tasks.review_deadline_at`, read by the sweeper), not in this queue.
   * A task must still submit successfully even if Redis is down at that
   * exact moment — that is the entire reason the sweeper exists.
   */
  async schedule(taskId: string, delayMs: number): Promise<void> {
    const jobId = jobIdFor(taskId);
    try {
      await this.queue.remove(jobId);
      await this.queue.add(
        AUTO_APPROVE_JOB_NAME,
        { taskId },
        { jobId, delay: Math.max(delayMs, 0), removeOnComplete: true, removeOnFail: true },
      );
    } catch (error) {
      this.logger.warn(
        `Could not schedule the auto-approve queue job for task ${taskId}; the sweeper will still catch it at its deadline. ${String(error)}`,
      );
    }
  }

  /** Best-effort cleanup after a manual approve/reject, so a stale job doesn't fire a no-op later. */
  async cancel(taskId: string): Promise<void> {
    try {
      await this.queue.remove(jobIdFor(taskId));
    } catch (error) {
      this.logger.warn(`Could not cancel the auto-approve job for task ${taskId}: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
