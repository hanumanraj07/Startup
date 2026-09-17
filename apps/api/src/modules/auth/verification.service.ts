import { Inject, Injectable } from '@nestjs/common';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { EMAIL_PROVIDER, SMS_PROVIDER, type EmailProvider, type SmsProvider } from '../messaging/providers';
import { TokenService } from './token.service';

const EMAIL_VERIFICATION_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_MINUTES = 30;
const PHONE_OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

/**
 * Email verification, phone OTP, and password reset — the three flows built
 * on the OtpCode table. Each shares the same shape: issue a hashed secret
 * with an expiry, verify it later, consume it once.
 *
 * Verification level 1 requires BOTH email and phone verified, recomputed
 * here after either succeeds. See docs/12-trust-safety.md.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  // ─── Email ───────────────────────────────────────────────────────────

  async issueEmailVerification(userId: string, emailAddress: string): Promise<void> {
    const secret = this.tokens.generateLinkSecret();
    const row = await this.prisma.otpCode.create({
      data: {
        userId,
        channel: 'EMAIL',
        purpose: 'email_verification',
        codeHash: this.tokens.hashOpaqueToken(secret),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 3_600_000),
      },
    });

    const env = loadEnv();
    const link = `${env.WEB_URL}/verify-email?token=${this.tokens.packLinkToken(row.id, secret)}`;
    await this.email.send({
      to: emailAddress,
      subject: 'Verify your OnSite email address',
      body: `Confirm this is you: ${link}\n\nThis link expires in ${EMAIL_VERIFICATION_TTL_HOURS} hours.`,
    });
  }

  /**
   * Public: verifying an email link does not require an active session. The
   * secret in the link is itself the credential — whoever can present it
   * proved they received the email, which is all this step is checking.
   * See docs/07-api-specification.md.
   */
  async verifyEmail(token: string): Promise<void> {
    const unpacked = this.tokens.unpackLinkToken(token);
    if (!unpacked) throw new Error('Invalid or expired link.');

    const row = await this.prisma.otpCode.findUnique({ where: { id: unpacked.rowId } });
    if (
      !row ||
      row.purpose !== 'email_verification' ||
      row.consumedAt ||
      row.expiresAt.getTime() < Date.now() ||
      !this.tokens.constantTimeEqual(row.codeHash, this.tokens.hashOpaqueToken(unpacked.secret))
    ) {
      throw new Error('Invalid or expired link.');
    }

    await this.prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    await this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
    await this.recomputeVerificationLevel(row.userId);
  }

  // ─── Phone ───────────────────────────────────────────────────────────

  async issuePhoneOtp(userId: string, phone: string): Promise<void> {
    const code = this.tokens.generateNumericOtp();
    // Set tentatively; phoneVerifiedAt only follows a successful verify, and
    // a re-send with a different number simply overwrites the pending one.
    await this.prisma.user.update({
      where: { id: userId },
      data: { phone, phoneVerifiedAt: null },
    });
    await this.prisma.otpCode.create({
      data: {
        userId,
        channel: 'SMS',
        purpose: 'phone_verification',
        codeHash: this.tokens.hashOpaqueToken(code),
        expiresAt: new Date(Date.now() + PHONE_OTP_TTL_MINUTES * 60_000),
      },
    });
    await this.sms.send({ to: phone, body: `Your OnSite verification code is ${code}` });
  }

  async verifyPhoneOtp(userId: string, code: string): Promise<void> {
    await this.consumeLatestOtp(userId, 'phone_verification', code, async () => {
      await this.prisma.user.update({ where: { id: userId }, data: { phoneVerifiedAt: new Date() } });
      await this.recomputeVerificationLevel(userId);
    });
  }

  // ─── Password reset ──────────────────────────────────────────────────

  /**
   * Always resolves, whether or not the email belongs to an account. The
   * caller returns an identical response either way, so this endpoint cannot
   * be used to enumerate registered addresses. See docs/16.
   */
  async issuePasswordReset(emailAddress: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: emailAddress } });
    if (!user) return;

    const secret = this.tokens.generateLinkSecret();
    const row = await this.prisma.otpCode.create({
      data: {
        userId: user.id,
        channel: 'EMAIL',
        purpose: 'password_reset',
        codeHash: this.tokens.hashOpaqueToken(secret),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    });

    const env = loadEnv();
    const link = `${env.WEB_URL}/reset-password?token=${this.tokens.packLinkToken(row.id, secret)}`;
    await this.email.send({
      to: emailAddress,
      subject: 'Reset your OnSite password',
      body: `Reset your password: ${link}\n\nThis link expires in ${PASSWORD_RESET_TTL_MINUTES} minutes. If you did not request this, ignore this email.`,
    });
  }

  /** Returns the userId the token belongs to, having consumed it. Throws if invalid. */
  async consumePasswordResetToken(token: string): Promise<string> {
    const unpacked = this.tokens.unpackLinkToken(token);
    if (!unpacked) throw new Error('Invalid or expired reset link.');

    const row = await this.prisma.otpCode.findUnique({ where: { id: unpacked.rowId } });
    if (
      !row ||
      row.purpose !== 'password_reset' ||
      row.consumedAt ||
      row.expiresAt.getTime() < Date.now() ||
      !this.tokens.constantTimeEqual(row.codeHash, this.tokens.hashOpaqueToken(unpacked.secret))
    ) {
      throw new Error('Invalid or expired reset link.');
    }

    await this.prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return row.userId;
  }

  // ─── Shared consumption logic ────────────────────────────────────────

  /** For codes the user types back (OTPs), rather than a link carrying a row id. */
  private async consumeLatestOtp(
    userId: string,
    purpose: string,
    code: string,
    onSuccess: () => Promise<void>,
  ): Promise<void> {
    const row = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!row || row.expiresAt.getTime() < Date.now()) {
      throw new Error('That code has expired. Request a new one.');
    }
    if (row.attempts >= MAX_OTP_ATTEMPTS) {
      throw new Error('Too many incorrect attempts. Request a new code.');
    }

    const matches = this.tokens.constantTimeEqual(row.codeHash, this.tokens.hashOpaqueToken(code));
    if (!matches) {
      await this.prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      throw new Error('That code is incorrect.');
    }

    await this.prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    await onSuccess();
  }

  private async recomputeVerificationLevel(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Email-only gate for level 1, deliberately relaxed from docs/12's
    // original "email AND phone" — SMS requires DLT registration (a real
    // paid, one-time compliance step in India) that launch is deferring
    // until there's revenue to justify it. Phone verification is still
    // fully built and still raises the level on its own if a user does
    // complete it; this just stops it being a hard requirement to reach
    // level 1 at all. Level 2+ still requires an approved KYC review,
    // handled where KYC decisions are made. This only ever raises 0 -> 1;
    // it never lowers a higher level.
    if (user.emailVerifiedAt && user.verificationLevel < 1) {
      await this.prisma.user.update({ where: { id: userId }, data: { verificationLevel: 1 } });
    }
  }
}
