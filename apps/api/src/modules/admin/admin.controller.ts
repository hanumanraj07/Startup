import { Body, Controller, Get, Ip, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  adminModerationListSchema,
  createCategorySchema,
  createCitySchema,
  kycDecisionSchema,
  moderationDecisionSchema,
  paginationSchema,
  resolveDisputeSchema,
  suspendUserSchema,
  updateCategorySchema,
  updateCitySchema,
  uuidSchema,
  type AdminModerationListInput,
  type CreateCategoryInput,
  type CreateCityInput,
  type KycDecisionInput,
  type ModerationDecisionInput,
  type ResolveDisputeInput,
  type SuspendUserInput,
  type UpdateCategoryInput,
  type UpdateCityInput,
} from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { DisputesService } from '../disputes/disputes.service';
import { ModerationService } from '../moderation/moderation.service';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

/**
 * docs/07-api-specification.md's Admin section: "All require
 * `platform_role = ADMIN`. All write actions produce an audit log entry."
 * See admin.service.ts's comment for what this pass deliberately does not
 * cover yet (task blocking, payout retry).
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly disputes: DisputesService,
    private readonly moderation: ModerationService,
  ) {}

  /** Blocked tasks and appeals. Default view is appeals waiting for a decision. */
  @Get('moderation')
  async listModeration(@Query(zodPipe(adminModerationListSchema)) query: AdminModerationListInput) {
    return this.moderation.listForAdmin(query);
  }

  @Post('moderation/:id/decision')
  async decideModeration(
    @Param('id') id: string,
    @Body(zodPipe(moderationDecisionSchema)) body: ModerationDecisionInput,
    @CurrentUser() admin: RequestUser,
    @Ip() ip: string,
  ) {
    return this.moderation.decide(uuidSchema.parse(id), admin.id, body, ip);
  }

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

  @Get('tasks/:id')
  async taskDetail(@Param('id') id: string) {
    return this.admin.getTaskDetail(uuidSchema.parse(id));
  }

  @Get('metrics')
  async metrics() {
    return this.admin.getDashboardMetrics();
  }

  @Get('categories')
  async listCategories() {
    return { data: await this.admin.listCategoriesAdmin() };
  }

  @Post('categories')
  async createCategory(
    @Body(zodPipe(createCategorySchema)) body: CreateCategoryInput,
    @CurrentUser() admin: RequestUser,
    @Ip() ip: string,
  ) {
    return this.admin.createCategory(admin.id, ip, body);
  }

  @Patch('categories/:id')
  async updateCategory(
    @Param('id') id: string,
    @Body(zodPipe(updateCategorySchema)) body: UpdateCategoryInput,
    @CurrentUser() admin: RequestUser,
    @Ip() ip: string,
  ) {
    return this.admin.updateCategory(uuidSchema.parse(id), admin.id, ip, body);
  }

  @Get('cities')
  async listCities() {
    return { data: await this.admin.listCitiesAdmin() };
  }

  @Post('cities')
  async createCity(
    @Body(zodPipe(createCitySchema)) body: CreateCityInput,
    @CurrentUser() admin: RequestUser,
    @Ip() ip: string,
  ) {
    return this.admin.createCity(admin.id, ip, body);
  }

  @Patch('cities/:id')
  async updateCity(
    @Param('id') id: string,
    @Body(zodPipe(updateCitySchema)) body: UpdateCityInput,
    @CurrentUser() admin: RequestUser,
    @Ip() ip: string,
  ) {
    return this.admin.updateCity(uuidSchema.parse(id), admin.id, ip, body);
  }
}
