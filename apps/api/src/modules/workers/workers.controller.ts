import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import {
  availabilitySchema,
  workerProfileSchema,
  type WorkerProfileInput,
} from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { WorkersService } from './workers.service';

/**
 * The Zod pipe is bound to the @Body() PARAMETER, not via a method-level
 * @UsePipes(). A method-level pipe runs against every parameter of the
 * handler, including @CurrentUser() — which then gets validated against the
 * body schema and fails with "Required" on every field, because it is
 * obviously not a request body. Scoping the pipe to @Body() is what makes it
 * apply only to the value it is meant to validate.
 */
@Controller('workers')
export class WorkersController {
  constructor(private readonly workers: WorkersService) {}

  @Post('me')
  async create(
    @Body(zodPipe(workerProfileSchema)) body: WorkerProfileInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.workers.createProfile(user.id, body);
  }

  @Get('me')
  async me(@CurrentUser() user: RequestUser) {
    return this.workers.getSelf(user.id);
  }

  @Patch('me')
  async update(
    @Body(zodPipe(workerProfileSchema.partial())) body: Partial<WorkerProfileInput>,
    @CurrentUser() user: RequestUser,
  ) {
    return this.workers.updateProfile(user.id, body);
  }

  @Patch('me/availability')
  async setAvailability(
    @Body(zodPipe(availabilitySchema)) body: { isAvailable: boolean },
    @CurrentUser() user: RequestUser,
  ) {
    return this.workers.setAvailability(user.id, body.isAvailable);
  }

  @Get('me/stats')
  async stats(@CurrentUser() user: RequestUser) {
    return this.workers.getStats(user.id);
  }
}
