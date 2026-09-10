import { Body, Controller, Post, Param } from '@nestjs/common';
import { reviewSchema, uuidSchema, type ReviewInput } from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { RatingsService } from './ratings.service';

/** docs/07-api-specification.md's Review section: `POST /tasks/:id/review`. */
@Controller('tasks')
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Post(':id/review')
  async submit(
    @Param('id') id: string,
    @Body(zodPipe(reviewSchema)) body: ReviewInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ratings.submit(uuidSchema.parse(id), user.id, body);
  }
}
