import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  arriveSchema,
  blockerSchema,
  cancelTaskSchema,
  createTaskSchema,
  myTasksSchema,
  nearbyTasksSchema,
  presignUploadSchema,
  recordProofSchema,
  rejectTaskSchema,
  submitTaskSchema,
  updateTaskSchema,
  uuidSchema,
  type ArriveInput,
  type BlockerInput,
  type CancelTaskInput,
  type CreateTaskInput,
  type MyTasksInput,
  type NearbyTasksInput,
  type PresignUploadInput,
  type RecordProofInput,
  type RejectTaskInput,
  type SubmitTaskInput,
  type UpdateTaskInput,
} from '@onsite/validation';
import { formatDistance } from '@onsite/utils';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { ExecutionService } from './execution.service';
import { ReviewService } from './review.service';
import { TasksService } from './tasks.service';

// docs/07-api-specification.md specifies both of these per USER, not per IP
// — `user` is the dimension that actually enforces that (see
// AccountAwareThrottlerGuard). Deliberately NOT also tightening `default`
// down to the same number: these routes have no IP-specific abuse concern
// docs calls out (unlike login, where credential stuffing is IP-relevant
// too), so `default` is left at the module's 300/min baseline. Found live,
// load-testing the accept herd: tightening both dimensions to the identical
// limit means many different legitimate users sharing one IP — a mobile
// carrier's CGNAT is common in India, or 50 workers racing to accept a task
// from genuinely different locations that happen to share one corporate or
// campus gateway — collide on the IP bucket long before any of them
// individually did anything wrong. The per-user limit is the one the spec
// actually asks for; the IP dimension exists as a broad safety net, not a
// second copy of the same number.
const CREATE_THROTTLE = { user: { limit: 20, ttl: 3_600_000 } }; // 20 per hour, per user
const ACCEPT_THROTTLE = { user: { limit: 30, ttl: 60_000 } }; // 30 per minute, per worker
// "60 per hour per task" — a third dimension keyed by the task id, which
// AccountAwareThrottlerGuard does not implement yet. Left IP-based only;
// recorded as a gap in TODO.md rather than silently claimed as done.
const PRESIGN_THROTTLE = { default: { limit: 60, ttl: 3_600_000 } };

/**
 * Every Zod pipe is bound to its @Body()/@Query() parameter directly, never
 * via a method-level @UsePipes(). See the note in workers.controller.ts and
 * ai/memory.md for why: a method-level pipe validates every parameter of the
 * handler, including @CurrentUser(), which breaks silently.
 */
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly execution: ExecutionService,
    private readonly review: ReviewService,
  ) {}

  /**
   * The worker feed. Authenticated, per docs/07-api-specification.md — not
   * because the query itself is sensitive, but because eligibility depends on
   * identity: the caller's own tasks are excluded, and their real
   * verification level (never a client-supplied one) determines which tasks
   * they are even shown.
   */
  @Get('nearby')
  async nearby(@Query(zodPipe(nearbyTasksSchema)) query: NearbyTasksInput, @CurrentUser() user: RequestUser) {
    const results = await this.tasks.findNearby(query, user.id, user.verificationLevel);
    return { data: results.map((t) => ({ ...t, distanceLabel: formatDistance(t.distanceMeters) })), nextCursor: null };
  }

  @Throttle(CREATE_THROTTLE)
  @Post()
  async create(@Body(zodPipe(createTaskSchema)) body: CreateTaskInput, @CurrentUser() user: RequestUser) {
    return this.tasks.create(user.id, body);
  }

  @Get('mine')
  async mine(@Query(zodPipe(myTasksSchema)) query: MyTasksInput, @CurrentUser() user: RequestUser) {
    return this.tasks.listMine(user.id, query.limit, query.cursor, query.perspective);
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.tasks.getById(uuidSchema.parse(id), user.id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(zodPipe(updateTaskSchema)) body: UpdateTaskInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tasks.update(uuidSchema.parse(id), user.id, body);
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.tasks.publish(uuidSchema.parse(id), user.id);
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body(zodPipe(cancelTaskSchema)) body: CancelTaskInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tasks.cancel(uuidSchema.parse(id), user.id, body.reason);
  }

  @Throttle(ACCEPT_THROTTLE)
  @Post(':id/accept')
  async accept(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.tasks.accept(uuidSchema.parse(id), user.id);
  }

  // ─── Execution (assigned worker) ───────────────────────────────────

  @Post(':id/en-route')
  async enRoute(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.execution.markEnRoute(uuidSchema.parse(id), user.id);
  }

  @Post(':id/arrive')
  async arrive(
    @Param('id') id: string,
    @Body(zodPipe(arriveSchema)) body: ArriveInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.execution.confirmArrival(uuidSchema.parse(id), user.id, body);
  }

  @Throttle(PRESIGN_THROTTLE)
  @Post(':id/proofs/presign')
  async presignProof(
    @Param('id') id: string,
    @Body(zodPipe(presignUploadSchema)) body: PresignUploadInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.execution.presignProof(uuidSchema.parse(id), user.id, body);
  }

  @Post(':id/proofs')
  async recordProof(
    @Param('id') id: string,
    @Body(zodPipe(recordProofSchema)) body: RecordProofInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.execution.recordProof(uuidSchema.parse(id), user.id, body);
  }

  @Get(':id/proofs')
  async listProofs(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return { data: await this.execution.listProofs(uuidSchema.parse(id), user.id) };
  }

  @Delete(':id/proofs/:proofId')
  async deleteProof(
    @Param('id') id: string,
    @Param('proofId') proofId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.execution.deleteProof(uuidSchema.parse(id), uuidSchema.parse(proofId), user.id);
  }

  @Post(':id/submit')
  async submit(
    @Param('id') id: string,
    @Body(zodPipe(submitTaskSchema)) body: SubmitTaskInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.execution.submit(uuidSchema.parse(id), user.id, body.note);
  }

  @Post(':id/blocker')
  async blocker(
    @Param('id') id: string,
    @Body(zodPipe(blockerSchema)) body: BlockerInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.execution.reportBlocker(uuidSchema.parse(id), user.id, body);
  }

  // ─── Review (requester) ─────────────────────────────────────────────

  @Post(':id/approve')
  async approve(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.review.approve(uuidSchema.parse(id), user.id);
  }

  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body(zodPipe(rejectTaskSchema)) body: RejectTaskInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.review.reject(uuidSchema.parse(id), user.id, body.reason);
  }
}
