import { Body, Controller, Delete, Get, Param, Patch, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  deleteAccountSchema,
  kycPresignSchema,
  kycSubmissionSchema,
  payoutAccountSchema,
  updateProfileSchema,
  uuidSchema,
  type DeleteAccountInput,
  type KycPresignInput,
  type KycSubmissionInput,
  type PayoutAccountInput,
} from '@onsite/validation';
import type { UpdateProfileInput } from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { clearRefreshCookie } from '../auth/cookies';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { StorageService } from '../storage/storage.service';
import { UsersService } from './users.service';

// A wrong password should fail closed quickly, but a real user re-typing a
// mistyped password twice should never feel throttled — per-user, not per-IP,
// since the whole point is limiting attempts against ONE account.
const DELETE_ACCOUNT_THROTTLE = { user: { limit: 5, ttl: 3_600_000 } };

// Mirrors PRESIGN_THROTTLE in tasks.controller.ts and for the identical
// reason: each call mints a presigned PUT against real, billed object
// storage. A KYC submission needs at most two documents (front + selfie);
// nobody legitimate approaches even a fraction of this in an hour.
const KYC_PRESIGN_THROTTLE = { default: { limit: 20, ttl: 3_600_000 } };

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

  @Throttle(DELETE_ACCOUNT_THROTTLE)
  @Delete('me')
  async deleteMe(
    @Body(zodPipe(deleteAccountSchema)) body: DeleteAccountInput,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.users.deleteAccount(user.id, body);
    clearRefreshCookie(res);
    return result;
  }

  @Public()
  @Get(':id/public')
  async publicProfile(@Param('id') id: string) {
    const parsed = uuidSchema.parse(id);
    return this.users.getPublicProfile(parsed);
  }

  @Throttle(KYC_PRESIGN_THROTTLE)
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
