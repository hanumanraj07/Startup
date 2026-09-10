import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  Res,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  sendOtpSchema,
  verifyOtpSchema,
  type LoginInput,
  type RegisterInput,
} from '@onsite/validation';
import { z } from 'zod';
import { UnauthenticatedError } from '../../common/errors';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthService, type AuthResult } from './auth.service';
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from './cookies';
import { CurrentUser, type RequestUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { VerificationService } from './verification.service';

const verifyEmailSchema = z.object({ token: z.string().min(1) });

/**
 * Rate limits from docs/07-api-specification.md: the strictest tier, applied
 * per route. Two independent dimensions, per docs/16-security-requirements.md
 * ("per IP and per account, whichever binds first") — `default` is IP-based
 * (AccountAwareThrottlerGuard's normal behavior), `account` is keyed by the
 * email/phone in the request body. Either exceeding its own limit blocks the
 * request; a flood spread across many IPs against one account is caught by
 * `account` exactly as a flood from one IP against many accounts is caught
 * by `default`.
 */
const AUTH_THROTTLE = {
  default: { limit: 5, ttl: 900_000 }, // 5 per 15 minutes, per IP
  account: { limit: 5, ttl: 900_000 }, // 5 per 15 minutes, per account
};
const OTP_THROTTLE = {
  default: { limit: 3, ttl: 3_600_000 }, // 3 per hour, per IP
  account: { limit: 3, ttl: 3_600_000 }, // 3 per hour, per account
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly verification: VerificationService,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @UsePipes(zodPipe(registerSchema))
  async register(@Body() body: RegisterInput, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(body);
    return this.respondWithSession(result, res);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @UsePipes(zodPipe(loginSchema))
  async login(@Body() body: LoginInput, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body);
    return this.respondWithSession(result, res);
  }

  /**
   * No access token is required here by design — an expired access token is
   * exactly the situation this endpoint exists to recover from. Authority
   * comes entirely from the refresh cookie.
   */
  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!token) throw new UnauthenticatedError('Sign in to continue.');

    const result = await this.auth.refresh(token);
    return this.respondWithSession(result, res);
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (token) await this.auth.logout(token);
    clearRefreshCookie(res);
    return { success: true };
  }

  @Public()
  @Post('verify-email')
  @UsePipes(zodPipe(verifyEmailSchema))
  async verifyEmail(@Body() body: { token: string }) {
    try {
      await this.verification.verifyEmail(body.token);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return { success: true };
  }

  @Throttle(OTP_THROTTLE)
  @Post('phone/send-otp')
  async sendPhoneOtp(
    @Body(zodPipe(sendOtpSchema)) body: { phone: string },
    @CurrentUser() user: RequestUser,
  ) {
    await this.verification.issuePhoneOtp(user.id, body.phone);
    return { success: true };
  }

  @Throttle(OTP_THROTTLE)
  @Post('phone/verify-otp')
  async verifyPhoneOtp(
    @Body(zodPipe(verifyOtpSchema)) body: { phone: string; code: string },
    @CurrentUser() user: RequestUser,
  ) {
    try {
      await this.verification.verifyPhoneOtp(user.id, body.code);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return { success: true };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('password/forgot')
  @UsePipes(zodPipe(forgotPasswordSchema))
  async forgotPassword(@Body() body: { email: string }) {
    await this.auth.requestPasswordReset(body.email);
    // Identical response whether or not the address is registered.
    return { success: true, message: 'If an account exists for that email, a reset link is on its way.' };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('password/reset')
  @UsePipes(zodPipe(resetPasswordSchema))
  async resetPassword(@Body() body: { token: string; password: string }) {
    await this.auth.resetPassword(body.token, body.password);
    return { success: true };
  }

  private respondWithSession(result: AuthResult, res: Response) {
    setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
    // The refresh token never appears in the JSON body — cookie only.
    return { user: result.user, accessToken: result.accessToken };
  }
}
