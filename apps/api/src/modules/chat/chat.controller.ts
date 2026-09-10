import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { paginationSchema, sendMessageSchema, type SendMessageInput, uuidSchema } from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { ChatService } from './chat.service';

// docs/07-api-specification.md: "Messages | 60 per minute per user." `user`
// is what actually enforces that dimension — see AccountAwareThrottlerGuard.
// `default` is deliberately left at the module baseline — see
// tasks.controller.ts's CREATE_THROTTLE comment for why.
const MESSAGE_THROTTLE = { user: { limit: 60, ttl: 60_000 } };

@Controller('tasks')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get(':id/messages')
  async list(
    @Param('id') id: string,
    @Query(zodPipe(paginationSchema)) query: { limit: number; cursor?: string },
    @CurrentUser() user: RequestUser,
  ) {
    return this.chat.list(uuidSchema.parse(id), user.id, query.limit, query.cursor);
  }

  @Throttle(MESSAGE_THROTTLE)
  @Post(':id/messages')
  async send(
    @Param('id') id: string,
    @Body(zodPipe(sendMessageSchema)) body: SendMessageInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.chat.send(uuidSchema.parse(id), user.id, body);
  }

  @Post(':id/messages/read')
  async markRead(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.chat.markRead(uuidSchema.parse(id), user.id);
  }
}
