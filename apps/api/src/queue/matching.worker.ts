import { Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { MatchingService } from '../modules/matching/matching.service';
import { MATCHING_JOB_NAME, MATCHING_QUEUE_NAME, type MatchingJobData } from './matching.queue';
import { createBullConnection } from './redis-connection';

/**
 * The consumer side of the matching pipeline. Runs only in the worker process
 * (ROLE=worker) — see docs/05-system-architecture.md's process split — so a
 * burst of matching fan-out can never slow down request handling in the API
 * process. `runTierPass` is idempotent, so this needs no coordination with
 * anything else that might change the task in the meantime.
 */
export function startMatchingWorker(matching: MatchingService): Worker<MatchingJobData> {
  const logger = new Logger('MatchingWorker');

  const worker = new Worker<MatchingJobData>(
    MATCHING_QUEUE_NAME,
    async (job: Job<MatchingJobData>) => {
      if (job.name !== MATCHING_JOB_NAME) return;
      const result = await matching.runTierPass(job.data.taskId, job.data.tierIndex);
      if (result.acted && result.offered > 0) {
        logger.log(
          `Task ${job.data.taskId}: tier ${job.data.tierIndex + 1} offered to ${result.offered} worker(s).`,
        );
      }
    },
    { connection: createBullConnection() },
  );

  worker.on('failed', (job, error) => {
    logger.error(`Matching job for task ${job?.data.taskId} (tier ${job?.data.tierIndex}) failed: ${String(error)}`);
  });

  return worker;
}
