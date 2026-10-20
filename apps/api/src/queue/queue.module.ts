import { Global, Module } from '@nestjs/common';
import { AutoApproveQueue } from './auto-approve.queue';
import { MatchingQueue } from './matching.queue';
import { NotificationQueue } from './notification.queue';

@Global()
@Module({
  providers: [AutoApproveQueue, MatchingQueue, NotificationQueue],
  exports: [AutoApproveQueue, MatchingQueue, NotificationQueue],
})
export class QueueModule {}
