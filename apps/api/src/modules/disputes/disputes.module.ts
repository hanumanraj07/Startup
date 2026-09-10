import { Module } from '@nestjs/common';
import { LedgerService } from '../payments/ledger.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

/**
 * PrismaModule, QueueModule (AutoApproveQueue) and AuditModule are all
 * @Global(). `LedgerService` itself has no dependency beyond the (also
 * global) PrismaClient, so it is provided directly here rather than
 * importing all of PaymentsModule — which would also pull in
 * PaymentsController's routes — just for one stateless class.
 */
@Module({
  imports: [NotificationsModule, StorageModule],
  controllers: [DisputesController],
  providers: [DisputesService, LedgerService],
  exports: [DisputesService],
})
export class DisputesModule {}
