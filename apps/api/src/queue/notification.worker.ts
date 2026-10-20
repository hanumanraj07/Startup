import { Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { loadEnv } from '../config/env';
import { NotificationService } from '../modules/notifications/notification.service';
import { NOTIFICATION_JOB_NAME, NOTIFICATION_QUEUE_NAME, type NotificationJobData } from './notification.queue';
import { createBullConnection } from './redis-connection';

/**
 * Delivers push and email in the worker process (docs/22, #17). A delivery
 * that leaves a channel unsent throws, so BullMQ retries it with backoff;
 * NotificationService.deliver never sends a channel twice.
 */
export function startNotificationWorker(notifications: NotificationService): Worker<NotificationJobData> {
  const logger = new Logger('NotificationWorker');

  const worker = new Worker<NotificationJobData>(
    NOTIFICATION_QUEUE_NAME,
    async (job: Job<NotificationJobData>) => {
      if (job.name !== NOTIFICATION_JOB_NAME) return;
      const result = await notifications.deliver(job.data.notificationId);
      if (result === 'RETRY') throw new Error('A channel is still unsent.');
    },
    { connection: createBullConnection(), concurrency: loadEnv().NOTIFICATION_CONCURRENCY },
  );

  worker.on('failed', (job, error) => {
    const final = job ? job.attemptsMade >= (job.opts.attempts ?? 1) : true;
    if (final) logger.warn(`Notification ${job?.data.notificationId} delivery gave up: ${String(error)}`);
  });

  return worker;
}
