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
  googleAuthSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  sendOtpSchema,
  verifyOtpSchema,
  type GoogleAuthInput,
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
 * Rate limits from docs/07-api-specification.md, revised for shared mobile
 * IPs (docs/22, #7). The account is what is protected, so the account is
 * what is limited: `account` is keyed by the email/phone in the request
 * body, `user` by the signed-in user, and the real brute-force defence for
 * passwords is LoginAttemptsService's per-account backoff on failures.
 *
 * The per-IP `ip` dimension is only a flood guard. Jio and Airtel put
 * thousands of phones behind one public IP (carrier-grade NAT), so a tight
 * per-IP limit locks out everyone on a tower because a few people mistyped;
 * it used to be 5 per 15 minutes. Either dimension exceeding its own limit
 * blocks the request ("whichever binds first", docs/16).
 */
const AUTH_THROTTLE = {
  ip: { limit: 300, ttl: 900_000 }, // flood guard: 300 per 15 minutes, per IP
  account: { limit: 20, ttl: 900_000 }, // 20 per 15 minutes, per account
};
/** Each email costs money and lands in someone's inbox: few per account. */
const EMAIL_THROTTLE = {
  ip: { limit: 300, ttl: 900_000 },
  account: { limit: 3, ttl: 3_600_000 },
};
/** Signed-in routes: an SMS costs money, so sends are few per user. Wrong codes lock the code itself. */
const OTP_SEND_THROTTLE = {
  ip: { limit: 300, ttl: 3_600_000 },
  user: { limit: 3, ttl: 3_600_000 },
};
const OTP_VERIFY_THROTTLE = {
  ip: { limit: 300, ttl: 3_600_000 },
  user: { limit: 10, ttl: 3_600_000 },
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
   * The body carries only an ID token — no email/phone field for
   * AccountAwareThrottlerGuard's `account` dimension to key on, so this
   * reuses AUTH_THROTTLE's `default` (IP) dimension only; the guard falls
   * back to the IP suffix automatically when neither field is present,
   * exactly as it already does for any other public route with no account
   * identifier in its body.
   */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('google')
  @UsePipes(zodPipe(googleAuthSchema))
  async google(@Body() body: GoogleAuthInput, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.loginWithGoogle(body.idToken);
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

  @Throttle(OTP_SEND_THROTTLE)
  @Post('phone/send-otp')
  async sendPhoneOtp(
    @Body(zodPipe(sendOtpSchema)) body: { phone: string },
    @CurrentUser() user: RequestUser,
  ) {
    await this.verification.issuePhoneOtp(user.id, body.phone);
    return { success: true };
  }

  @Throttle(OTP_VERIFY_THROTTLE)
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
  @Throttle(EMAIL_THROTTLE)
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
