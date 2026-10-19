import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  createItemPurchaseSchema,
  rejectItemPurchaseSchema,
  uuidSchema,
  type CreateItemPurchaseInput,
} from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { ItemPurchasesService } from './item-purchases.service';

/**
 * Item bills on a task (P6): the worker sends one from the shop, the
 * requester approves or rejects it. Each route checks the caller's own
 * relationship to the task in the service. docs/07-api-specification.md.
 */
@Controller('tasks/:id/purchases')
export class ItemPurchasesController {
  constructor(private readonly purchases: ItemPurchasesService) {}

  @Get()
  async list(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return { data: await this.purchases.list(uuidSchema.parse(id), user.id) };
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(
    @Param('id') id: string,
    @Body(zodPipe(createItemPurchaseSchema)) body: CreateItemPurchaseInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.purchases.create(uuidSchema.parse(id), user.id, body);
  }

  @Post(':purchaseId/withdraw')
  async withdraw(@Param('id') id: string, @Param('purchaseId') purchaseId: string, @CurrentUser() user: RequestUser) {
    return this.purchases.withdraw(uuidSchema.parse(id), uuidSchema.parse(purchaseId), user.id);
  }

  @Post(':purchaseId/retry-payment')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async retry(@Param('id') id: string, @Param('purchaseId') purchaseId: string, @CurrentUser() user: RequestUser) {
    return this.purchases.retryShopPayment(uuidSchema.parse(id), uuidSchema.parse(purchaseId), user.id);
  }

  @Post(':purchaseId/pay-cash')
  async payCash(@Param('id') id: string, @Param('purchaseId') purchaseId: string, @CurrentUser() user: RequestUser) {
    return this.purchases.switchToCash(uuidSchema.parse(id), uuidSchema.parse(purchaseId), user.id);
  }

  @Post(':purchaseId/approve')
  async approve(@Param('id') id: string, @Param('purchaseId') purchaseId: string, @CurrentUser() user: RequestUser) {
    return this.purchases.approve(uuidSchema.parse(id), uuidSchema.parse(purchaseId), user.id);
  }

  @Post(':purchaseId/reject')
  async reject(
    @Param('id') id: string,
    @Param('purchaseId') purchaseId: string,
    @Body(zodPipe(rejectItemPurchaseSchema)) body: { reason?: string },
    @CurrentUser() user: RequestUser,
  ) {
    return this.purchases.reject(uuidSchema.parse(id), uuidSchema.parse(purchaseId), user.id, body.reason);
  }
}
