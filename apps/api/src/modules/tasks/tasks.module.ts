import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SafetyModule } from '../safety/safety.module';
import { StorageModule } from '../storage/storage.module';
import { ExecutionService } from './execution.service';
import { ReviewService } from './review.service';
import { RiskService } from './risk.service';
import { SweeperService } from './sweeper.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [PaymentsModule, StorageModule, NotificationsModule, SafetyModule, RealtimeModule],
  controllers: [TasksController],
  providers: [TasksService, RiskService, ExecutionService, ReviewService, SweeperService],
  exports: [TasksService, ReviewService, SweeperService],
})
export class TasksModule {}
