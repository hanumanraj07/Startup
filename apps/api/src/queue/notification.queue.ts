import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createBullConnection, withTimeout } from './redis-connection';

export const NOTIFICATION_QUEUE_NAME = 'notification-delivery';
export const NOTIFICATION_JOB_NAME = 'deliver';

export interface NotificationJobData {
  notificationId: string;
}

/**
 * Push and email for a notification, sent by the worker process rather than
 * inside the request that caused it (docs/22, #17): one slow or failing
 * provider used to slow or time out every accept, approval and matching
 * wave. The notification row is the outbox (NotificationService.notify writes
 * it with the channels still to send); this queue is the fast path. A job
 * that never gets here, Redis being down, is picked up by the sweeper.
 */
@Injectable()
export class NotificationQueue implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationQueue.name);
  private readonly queue = new Queue<NotificationJobData>(NOTIFICATION_QUEUE_NAME, {
    connection: createBullConnection(),
  });

  /** Best-effort and quick: never fails or holds up the caller. */
  async enqueue(notificationId: string): Promise<void> {
    try {
      await withTimeout(
        this.queue.add(
          NOTIFICATION_JOB_NAME,
          { notificationId },
          {
            jobId: `${NOTIFICATION_JOB_NAME}--${notificationId}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 10_000 },
            removeOnComplete: true,
            removeOnFail: { age: 7 * 24 * 3600 },
          },
        ),
      );
    } catch (error) {
      this.logger.warn(`Notification ${notificationId} not queued; the sweeper will deliver it. ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
