import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SafetyModule } from '../safety/safety.module';
import { MatchingService } from './matching.service';

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
  imports: [NotificationsModule, SafetyModule],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
