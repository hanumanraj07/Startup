import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  kycPresignSchema,
  kycSubmissionSchema,
  payoutAccountSchema,
  updateProfileSchema,
  uuidSchema,
  type KycPresignInput,
  type KycSubmissionInput,
  type PayoutAccountInput,
} from '@onsite/validation';
import type { UpdateProfileInput } from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { StorageService } from '../storage/storage.service';
import { UsersService } from './users.service';

/**
 * Every Zod pipe here is bound to the @Body() parameter directly, not via a
 * method-level @UsePipes(). A method-level pipe runs against every
 * parameter of the handler, including @CurrentUser() — which then gets
 * validated against the body schema and fails on every field, since it is
 * plainly not a request body. See the equivalent note in workers.controller.ts.
 */
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly storage: StorageService,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: RequestUser) {
    return this.users.getSelf(user.id);
  }

  @Patch('me')
  async updateMe(
    @Body(zodPipe(updateProfileSchema)) body: UpdateProfileInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.users.updateSelf(user.id, body);
  }

  @Public()
  @Get(':id/public')
  async publicProfile(@Param('id') id: string) {
    const parsed = uuidSchema.parse(id);
    return this.users.getPublicProfile(parsed);
  }

  @Post('me/kyc/presign')
  async presignKycDocument(
    @Body(zodPipe(kycPresignSchema)) body: KycPresignInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.storage.presignKycDocumentUpload({ userId: user.id, kind: body.kind, contentType: body.contentType });
  }

  @Post('me/kyc')
  async submitKyc(
    @Body(zodPipe(kycSubmissionSchema)) body: KycSubmissionInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.users.submitKyc(user.id, body);
  }

  @Get('me/kyc')
  async kycStatus(@CurrentUser() user: RequestUser) {
    return this.users.getOwnKycStatus(user.id);
  }

  @Post('me/payout-accounts')
  async addPayoutAccount(
    @Body(zodPipe(payoutAccountSchema)) body: PayoutAccountInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.users.addPayoutAccount(user.id, body);
  }

  @Get('me/payout-accounts')
  async listPayoutAccounts(@CurrentUser() user: RequestUser) {
    return this.users.listPayoutAccounts(user.id);
  }
}
