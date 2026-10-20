import { Module } from '@nestjs/common';
import { DisputesModule } from '../disputes/disputes.module';
import { ModerationModule } from '../moderation/moderation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { StorageModule } from '../storage/storage.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { EncryptionService } from '../../common/encryption.service';

/** AuditModule and PrismaModule are both @Global(). */
@Module({
  imports: [StorageModule, NotificationsModule, DisputesModule, ModerationModule, PaymentsModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard, EncryptionService],
})
export class AdminModule {}
