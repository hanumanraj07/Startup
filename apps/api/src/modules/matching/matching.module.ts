import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SafetyModule } from '../safety/safety.module';
import { MatchingService } from './matching.service';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

/**
 * PrismaModule and QueueModule are both @Global(), so most of
 * MatchingService's dependencies (PrismaService, GeoRepository,
 * MatchingQueue) are available without importing either module here.
 * NotificationsModule and SafetyModule are not global and are imported
 * explicitly, for the NEW_TASK_NEARBY notification and the blocked-user
 * exclusion respectively. This module exists to give MatchingService a home
 * other modules can import, and so main.ts's worker process can retrieve it
 * with `context.get(MatchingService)`.
 */
@Module({
  imports: [NotificationsModule, SafetyModule, RealtimeModule],
  controllers: [OffersController],
  providers: [MatchingService, OffersService],
  exports: [MatchingService, OffersService],
})
export class MatchingModule {}
