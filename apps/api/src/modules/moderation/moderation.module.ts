import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { OpenAiModerationClient } from './openai-moderation.client';

@Module({
  imports: [NotificationsModule],
  controllers: [ModerationController],
  providers: [ModerationService, OpenAiModerationClient],
  exports: [ModerationService],
})
export class ModerationModule {}
