import { Global, Module } from '@nestjs/common';
import { RealtimePublisher } from './realtime.publisher';

/**
 * RealtimePublisher, available everywhere. It has no dependencies of its own,
 * and modules that RealtimeModule itself depends on (auth) need it to cut a
 * user's live connections when their sessions are revoked (docs/22, #22).
 * Importing RealtimeModule there would be a cycle.
 */
@Global()
@Module({
  providers: [RealtimePublisher],
  exports: [RealtimePublisher],
})
export class RealtimePublisherModule {}
