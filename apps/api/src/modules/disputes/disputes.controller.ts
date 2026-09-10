import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  createDisputeSchema,
  disputeStatementSchema,
  paginationSchema,
  uuidSchema,
  type CreateDisputeInput,
  type DisputeStatementInput,
} from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { DisputesService } from './disputes.service';

/** docs/07-api-specification.md's Disputes section. */
@Controller()
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post('tasks/:id/dispute')
  async raise(
    @Param('id') id: string,
    @Body(zodPipe(createDisputeSchema)) body: CreateDisputeInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.disputes.raise(uuidSchema.parse(id), user.id, body);
  }

  @Get('disputes/mine')
  async mine(
    @Query(zodPipe(paginationSchema)) query: { limit: number; cursor?: string },
    @CurrentUser() user: RequestUser,
  ) {
    return this.disputes.listMine(user.id, query.limit, query.cursor);
  }

  @Get('disputes/:id')
  async getById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.disputes.getById(uuidSchema.parse(id), user.id);
  }

  @Post('disputes/:id/statement')
  async addStatement(
    @Param('id') id: string,
    @Body(zodPipe(disputeStatementSchema)) body: DisputeStatementInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.disputes.addStatement(uuidSchema.parse(id), user.id, body);
  }
}
