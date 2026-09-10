import { Body, Controller, Param, Post } from '@nestjs/common';
import { blockUserSchema, reportUserSchema, uuidSchema, type BlockUserInput, type ReportUserInput } from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { SafetyService } from './safety.service';

/** docs/07-api-specification.md's "Reference and safety" section. */
@Controller()
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Post('reports')
  async report(@Body(zodPipe(reportUserSchema)) body: ReportUserInput, @CurrentUser() user: RequestUser) {
    return this.safety.report(user.id, body);
  }

  @Post('users/:id/block')
  async block(
    @Param('id') id: string,
    @Body(zodPipe(blockUserSchema)) body: BlockUserInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.safety.block(user.id, uuidSchema.parse(id), body);
  }
}
