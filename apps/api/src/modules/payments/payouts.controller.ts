import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { paginationSchema } from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { PayoutsService } from './payouts.service';

/**
 * A worker's money: what they are owed, what is on its way, what has been
 * paid, and the history behind it. Each route reads only the caller's own
 * payouts. docs/07-api-specification.md.
 */
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get('mine')
  async mine(
    @Query(zodPipe(paginationSchema)) query: { limit: number; cursor?: string },
    @CurrentUser() user: RequestUser,
  ) {
    return this.payouts.listMine(user.id, query.limit, query.cursor);
  }

  @Get('summary')
  async summary(@CurrentUser() user: RequestUser) {
    return this.payouts.summary(user.id);
  }

  /** "Pay out now": sends everything owed to the verified default account. */
  @Throttle({ user: { limit: 10, ttl: 3_600_000 } })
  @Post('settle')
  @HttpCode(200)
  async settle(@CurrentUser() user: RequestUser) {
    return this.payouts.settleMine(user.id);
  }
}
