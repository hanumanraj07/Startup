import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createPaymentOrderSchema, paginationSchema, type CreatePaymentOrderInput } from '@onsite/validation';
import { ValidationError } from '../../common/errors';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';

// docs/07: "Payment creation: 10 per hour per user." `user` is what actually
// enforces that dimension — see AccountAwareThrottlerGuard. `default` is
// deliberately left at the module baseline rather than also tightened to
// 10/hour — see tasks.controller.ts's CREATE_THROTTLE comment for why
// duplicating the same tight number onto the IP dimension is wrong.
const PAYMENT_THROTTLE = { user: { limit: 10, ttl: 3_600_000 } };

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Throttle(PAYMENT_THROTTLE)
  @Post('orders')
  async createOrder(
    @Body(zodPipe(createPaymentOrderSchema)) body: CreatePaymentOrderInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!idempotencyKey) {
      throw new ValidationError('The Idempotency-Key header is required for payment operations.');
    }
    return this.payments.createOrder({
      taskId: body.taskId,
      requesterId: user.id,
      idempotencyKey,
    });
  }

  // Declared before ':taskId' — route matching follows declaration order,
  // and a path param route would otherwise swallow '/payments/mine' by
  // treating "mine" as a taskId.
  @Get('mine')
  async mine(
    @Query(zodPipe(paginationSchema)) query: { limit: number; cursor?: string },
    @CurrentUser() user: RequestUser,
  ) {
    return this.payments.listMine(user.id, query.limit, query.cursor);
  }

  @Get(':taskId')
  async getForTask(@Param('taskId') taskId: string, @CurrentUser() user: RequestUser) {
    return this.payments.getForTask(taskId, user.id);
  }
}
