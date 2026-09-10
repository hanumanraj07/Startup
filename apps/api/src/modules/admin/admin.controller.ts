import { Body, Controller, Get, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  kycDecisionSchema,
  paginationSchema,
  resolveDisputeSchema,
  suspendUserSchema,
  uuidSchema,
  type KycDecisionInput,
  type ResolveDisputeInput,
  type SuspendUserInput,
} from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { DisputesService } from '../disputes/disputes.service';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

/**
 * docs/07-api-specification.md's Admin section: "All require
 * `platform_role = ADMIN`. All write actions produce an audit log entry."
 * See admin.service.ts's comment for what this pass deliberately does not
 * cover yet (task blocking, payout retry, metrics dashboard).
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly disputes: DisputesService,
  ) {}

  @Get('kyc')
  async kycQueue(@Query(zodPipe(paginationSchema)) query: { limit: number; cursor?: string }) {
    return this.admin.listKycQueue(query.limit, query.cursor);
  }

  @Post('kyc/:id/decision')
  async decideKyc(
    @Param('id') id: string,
    @Body(zodPipe(kycDecisionSchema)) body: KycDecisionInput,
    @CurrentUser() admin: RequestUser,
    @Ip() ip: string,
  ) {
    return this.admin.decideKyc(uuidSchema.parse(id), admin.id, ip, body);
  }

  @Get('disputes')
  async disputesQueue(@Query(zodPipe(paginationSchema)) query: { limit: number; cursor?: string }) {
    return this.disputes.listForAdmin(query.limit, query.cursor);
  }

  @Get('disputes/:id/evidence')
  async disputeEvidence(@Param('id') id: string) {
    return this.disputes.getEvidenceBundle(uuidSchema.parse(id));
  }

  @Post('disputes/:id/resolve')
  async resolveDispute(
    @Param('id') id: string,
    @Body(zodPipe(resolveDisputeSchema)) body: ResolveDisputeInput,
    @CurrentUser() admin: RequestUser,
    @Ip() ip: string,
  ) {
    return this.disputes.resolve(uuidSchema.parse(id), admin.id, ip, body);
  }

  @Get('users')
  async searchUsers(@Query('q') q: string | undefined, @Query(zodPipe(paginationSchema)) query: { limit: number }) {
    return { data: await this.admin.searchUsers((q ?? '').trim(), query.limit) };
  }

  @Post('users/:id/suspend')
  async suspendUser(
    @Param('id') id: string,
    @Body(zodPipe(suspendUserSchema)) body: SuspendUserInput,
    @CurrentUser() admin: RequestUser,
    @Ip() ip: string,
  ) {
    return this.admin.suspendUser(uuidSchema.parse(id), admin.id, ip, body);
  }

  @Get('tasks')
  async listTasks(
    @Query('status') status: string | undefined,
    @Query('riskLevel') riskLevel: string | undefined,
    @Query(zodPipe(paginationSchema)) query: { limit: number },
  ) {
    return { data: await this.admin.listTasks({ status, riskLevel }, query.limit) };
  }
}
