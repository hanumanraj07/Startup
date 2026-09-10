import { Body, Controller, Delete, Get, Patch, Post, Query } from '@nestjs/common';
import {
  markNotificationsReadSchema,
  notificationPreferencesSchema,
  paginationSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
  type MarkNotificationsReadInput,
  type NotificationPreferencesInput,
  type PushSubscribeInput,
  type PushUnsubscribeInput,
} from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { NotificationService } from './notification.service';

/** docs/07-api-specification.md's Notifications section. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  async list(
    @Query(zodPipe(paginationSchema)) query: { limit: number; cursor?: string },
    @CurrentUser() user: RequestUser,
  ) {
    return this.notifications.list(user.id, query.limit, query.cursor);
  }

  @Post('read')
  async markRead(
    @Body(zodPipe(markNotificationsReadSchema)) body: MarkNotificationsReadInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notifications.markRead(user.id, body.ids);
  }

  @Get('preferences')
  async getPreferences(@CurrentUser() user: RequestUser) {
    return this.notifications.getPreferences(user.id);
  }

  @Patch('preferences')
  async updatePreferences(
    @Body(zodPipe(notificationPreferencesSchema)) body: NotificationPreferencesInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notifications.updatePreferences(user.id, body);
  }

  @Post('push/subscribe')
  async subscribePush(
    @Body(zodPipe(pushSubscribeSchema)) body: PushSubscribeInput,
    @CurrentUser() user: RequestUser,
  ) {
    await this.notifications.subscribePush(user.id, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: body.userAgent,
    });
    return { subscribed: true };
  }

  @Delete('push/subscribe')
  async unsubscribePush(
    @Body(zodPipe(pushUnsubscribeSchema)) body: PushUnsubscribeInput,
    @CurrentUser() user: RequestUser,
  ) {
    await this.notifications.unsubscribePush(user.id, body.endpoint);
    return { unsubscribed: true };
  }
}
