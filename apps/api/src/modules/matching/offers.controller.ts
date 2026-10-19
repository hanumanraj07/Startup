import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { OffersService } from './offers.service';

/**
 * A worker's open task requests. The live path is the `offer:new` socket
 * event; this is what the app reads when it opens or reconnects, so a request
 * sent while the screen was off still shows, with its remaining countdown.
 */
@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get('mine')
  async mine(@CurrentUser() user: RequestUser) {
    return { data: await this.offers.listOpenForWorker(user.id) };
  }
}
