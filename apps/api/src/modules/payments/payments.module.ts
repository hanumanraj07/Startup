import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PaymentsController } from './payments.controller';
import { PayoutsController } from './payouts.controller';
import { PaymentsService } from './payments.service';
import { RazorpayService } from './razorpay.service';

// LedgerService's PrismaClient constructor param is auto-wired from the
// @Global() PrismaModule (which binds PrismaClient to PrismaService); no
// factory is needed.
@Module({
  controllers: [PaymentsController, PayoutsController],
  providers: [PaymentsService, LedgerService, RazorpayService],
  exports: [PaymentsService, LedgerService],
})
export class PaymentsModule {}
