import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { StorageModule } from '../storage/storage.module';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

/**
 * PrismaModule, QueueModule (AutoApproveQueue) and AuditModule are all
 * @Global(). PaymentsModule supplies the ledger, the release that a decision
 * for the worker shares with an ordinary approval, and payouts.
 */
@Module({
  imports: [NotificationsModule, StorageModule, PaymentsModule],
  controllers: [DisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
