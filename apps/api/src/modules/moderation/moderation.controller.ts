import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { moderationAppealSchema, uuidSchema, type ModerationAppealInput } from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { ModerationService } from './moderation.service';

/** The user's side of moderation: their current posting restriction, and asking for a human review. */
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  /** Whether the caller can post right now; lets the task wizard show the countdown before they try. */
  @Get('restriction')
  async restriction(@CurrentUser() user: RequestUser) {
    const restriction = await this.moderation.getActiveRestriction(user.id);
    return restriction
      ? { restricted: true, eventId: restriction.eventId, restrictedUntil: restriction.until.toISOString(), reason: restriction.reason }
      : { restricted: false };
  }

  @Post('events/:id/appeal')
  async appeal(
    @Param('id') id: string,
    @Body(zodPipe(moderationAppealSchema)) body: ModerationAppealInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.moderation.appeal(uuidSchema.parse(id), user.id, body.note);
  }
}
