import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { identityTestConsentSchema, uuidSchema, type IdentityTestConsentInput } from '@onsite/validation';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { VerificationService } from './verification.service';

/** The signed-in user's own identity verification. docs/07-api-specification.md. */
@Controller('users/me/verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  async status(@CurrentUser() user: RequestUser) {
    return this.verification.status(user.id);
  }

  /** Starts a DigiLocker consent session. Also capped per day in the service. */
  @Throttle({ user: { limit: 5, ttl: 3_600_000 } })
  @Post('identity')
  async start(@CurrentUser() user: RequestUser) {
    return this.verification.startIdentity(user.id);
  }

  @Throttle({ user: { limit: 60, ttl: 60_000 } })
  @Post('identity/:id/refresh')
  @HttpCode(200)
  async refresh(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.verification.refreshIdentity(user.id, uuidSchema.parse(id));
  }

  /** The mock provider's consent screen. Not found with a real provider. */
  @Post('identity/:id/test-consent')
  @HttpCode(200)
  async testConsent(
    @Param('id') id: string,
    @Body(zodPipe(identityTestConsentSchema)) body: IdentityTestConsentInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.verification.completeTestIdentity(user.id, uuidSchema.parse(id), body);
  }
}
