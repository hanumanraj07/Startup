import { Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { ReviewService } from '../modules/tasks/review.service';
import { AUTO_APPROVE_JOB_NAME, AUTO_APPROVE_QUEUE_NAME, type AutoApproveJobData } from './auto-approve.queue';
import { createBullConnection } from './redis-connection';

/**
 * The consumer side of the fast path. Runs only in the worker process
 * (ROLE=worker) — see docs/05-system-architecture.md's process split — so a
 * burst of job processing can never slow down request handling in the API
 * process.
 *
 * `autoApprove` is idempotent (see review.service.ts), so this worker needs
 * no coordination with the sweeper: whichever of the two acts on a task
 * first wins, and the other's later attempt is a harmless no-op.
 */
export function startAutoApproveWorker(review: ReviewService): Worker<AutoApproveJobData> {
  const logger = new Logger('AutoApproveWorker');

  const worker = new Worker<AutoApproveJobData>(
    AUTO_APPROVE_QUEUE_NAME,
    async (job: Job<AutoApproveJobData>) => {
      if (job.name !== AUTO_APPROVE_JOB_NAME) return;
      const result = await review.autoApprove(job.data.taskId);
      if (result.acted) {
        logger.log(`Auto-approved task ${job.data.taskId} via the queue (fast path).`);
      }
    },
    { connection: createBullConnection() },
  );

  worker.on('failed', (job, error) => {
    logger.error(`Auto-approve job for task ${job?.data.taskId} failed: ${String(error)}`);
  });

  return worker;
}
