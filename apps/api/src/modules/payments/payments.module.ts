import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { StorageModule } from '../storage/storage.module';
import { ItemPurchasesController } from './item-purchases.controller';
import { ItemPurchasesService } from './item-purchases.service';
import { LedgerService } from './ledger.service';
import { PaymentsController } from './payments.controller';
import { PayoutsController } from './payouts.controller';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';
import { RazorpayService } from './razorpay.service';

// LedgerService's PrismaClient constructor param is auto-wired from the
// @Global() PrismaModule (which binds PrismaClient to PrismaService); no
// factory is needed.
@Module({
  imports: [ModerationModule, NotificationsModule, RealtimeModule, StorageModule],
  controllers: [PaymentsController, PayoutsController, ItemPurchasesController],
  providers: [PaymentsService, PayoutsService, LedgerService, RazorpayService, ItemPurchasesService],
  exports: [PaymentsService, PayoutsService, LedgerService, ItemPurchasesService],
})
export class PaymentsModule {}
