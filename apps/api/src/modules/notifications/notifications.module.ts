import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { PushService } from './push.service';

/**
 * MessagingModule (EMAIL_PROVIDER) and PrismaModule are both @Global(), so
 * NotificationService's dependencies are available without importing either
 * here.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationService, PushService],
  exports: [NotificationService, PushService],
})
export class NotificationsModule {}
