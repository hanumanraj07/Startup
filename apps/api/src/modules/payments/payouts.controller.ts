import { Controller, Get, Query } from '@nestjs/common';
import { paginationSchema } from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';

/** docs/07-api-specification.md: "GET /payouts/mine | worker | Payout history." */
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('mine')
  async mine(
    @Query(zodPipe(paginationSchema)) query: { limit: number; cursor?: string },
    @CurrentUser() user: RequestUser,
  ) {
    return this.payments.listPayoutsMine(user.id, query.limit, query.cursor);
  }
}
