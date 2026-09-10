import { Global, Module } from '@nestjs/common';
import { AutoApproveQueue } from './auto-approve.queue';
import { MatchingQueue } from './matching.queue';

@Global()
@Module({
  providers: [AutoApproveQueue, MatchingQueue],
  exports: [AutoApproveQueue, MatchingQueue],
})
export class QueueModule {}
