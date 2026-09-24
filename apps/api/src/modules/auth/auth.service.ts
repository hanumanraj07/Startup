import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { RegisterInput, LoginInput } from '@onsite/validation';
import { BusinessRuleError, ConflictError, UnauthenticatedError } from '../../common/errors';
import { toSelfUser } from '../../common/projections';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleAuthService } from './google-auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { VerificationService } from './verification.service';

export interface AuthResult {
  user: ReturnType<typeof toSelfUser>;
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/**
 * Registration, login, refresh rotation, and logout.
 *
 * The refresh-token rotation with reuse detection is the single highest-value
 * control here, per docs/16-security-requirements.md, so it gets the most
 * care: every refresh retires the presented token and issues a new one in the
 * same family; presenting an already-retired token is treated as evidence the
 * token was stolen, and the ENTIRE family is revoked, forcing re-authentication
 * on every device sharing that lineage.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly verification: VerificationService,
    private readonly google: GoogleAuthService,
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictError('An account with this email already exists.');
    }

    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.prisma.user.create({
      data: { email: input.email, passwordHash, displayName: input.displayName },
    });

    // Best-effort: a slow or failing email provider must never block account
    // creation. The user can request a fresh link later regardless.
    await this.verification.issueEmailVerification(user.id, user.email).catch((error) => {
      this.logger.warn(`Failed to send verification email to a new account: ${String(error)}`);
    });

    return this.issueSession(user.id);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    // Constant-shaped failure: whether the account exists or the password is
    // wrong, the response and, as far as practical, the timing are the same.
    // A verify() call runs either way so a valid email does not resolve faster
    // than an invalid one.
    const passwordHash = user?.passwordHash ?? '$argon2id$v=19$m=1,t=1,p=1$AAAAAAAAAAAAAAAA$AA';
    const passwordOk = await this.passwords.verify(passwordHash, input.password);

    if (!user || !user.passwordHash || !passwordOk) {
      throw new UnauthenticatedError('Incorrect email or password.');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthenticatedError('This account is not active.');
    }

    return this.issueSession(user.id);
  }

  /**
   * Sign-in with Google. The ID token is verified against Google's own
   * public keys and this app's client id before anything here trusts a
   * single field of it — see GoogleAuthService.
   *
   * Three cases, in order: an account already linked to this Google id logs
   * straight in; an existing password-based account with the same email
   * gets the Google id linked onto it (safe specifically because Google has
   * already independently verified ownership of that address — this is not
   * the same as trusting a client's own claim to an email); otherwise a new
   * account is created with no password at all, since Google is the only
   * way in for it.
   */
  async loginWithGoogle(idToken: string): Promise<AuthResult> {
    const profile = await this.google.verifyIdToken(idToken);

    let user = await this.prisma.user.findUnique({ where: { googleId: profile.googleId } });

    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: profile.email } });

      if (byEmail) {
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: profile.googleId,
            // Google already verified this address; that's a stronger proof
            // than this app's own email-link flow, not a weaker one. Never
            // downgrades an already-verified account.
            ...(profile.emailVerified && !byEmail.emailVerifiedAt ? { emailVerifiedAt: new Date() } : {}),
            ...(profile.emailVerified && byEmail.verificationLevel < 1 ? { verificationLevel: 1 } : {}),
          },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            email: profile.email,
            googleId: profile.googleId,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
            passwordHash: null,
            ...(profile.emailVerified ? { emailVerifiedAt: new Date(), verificationLevel: 1 } : {}),
          },
        });
      }
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthenticatedError('This account is not active.');
    }

    return this.issueSession(user.id);
  }

  /**
   * Rotates a refresh token.
   *
   *  - Unknown token            -> reject. Never existed or long expired.
   *  - Known, already revoked   -> REUSE. Revoke the whole family, reject.
   *  - Known, valid, unrevoked  -> retire it, issue a new one in the family.
   */
  async refresh(presentedToken: string): Promise<AuthResult> {
    const tokenHash = this.tokens.hashOpaqueToken(presentedToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      throw new UnauthenticatedError('Your session has expired. Please sign in again.');
    }

    if (stored.revokedAt) {
      // The token that should be the current one for this family has already
      // been used. Either it was replayed by an attacker who stole an old
      // token, or a legitimate client retried after losing the response to a
      // previous rotation. Either way, the safe action is identical: burn the
      // whole family and require a fresh login everywhere.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(
        `Refresh token reuse detected for family ${stored.familyId}; family revoked.`,
      );
      throw new UnauthenticatedError('Your session is no longer valid. Please sign in again.');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthenticatedError('Your session has expired. Please sign in again.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: { workerProfile: { select: { id: true } } },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthenticatedError('This account is not active.');
    }

    const next = this.tokens.generateRefreshToken();
    const env = loadEnv();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

    // One transaction: the old token is retired and the new one created
    // together, so a crash between the two steps cannot leave a family with
    // no valid token, or two simultaneously valid ones.
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: next.tokenHash,
          familyId: stored.familyId,
          expiresAt,
        },
      });
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), replacedById: row.id },
      });
      return row;
    });

    return {
      user: toSelfUser(user),
      accessToken: this.tokens.signAccessToken({
        sub: user.id,
        platformRole: user.platformRole,
        tokenVersion: user.tokenVersion,
      }),
      refreshToken: next.token,
      refreshTokenExpiresAt: created.expiresAt,
    };
  }

  /** Revokes the entire family the presented token belongs to. Idempotent. */
  async logout(presentedToken: string): Promise<void> {
    const tokenHash = this.tokens.hashOpaqueToken(presentedToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) return;

    await this.prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.verification.issuePasswordReset(email);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    let userId: string;
    try {
      userId = await this.verification.consumePasswordResetToken(token);
    } catch {
      throw new BusinessRuleError('This reset link is invalid or has expired.');
    }

    const passwordHash = await this.passwords.hash(newPassword);

    // Bumping tokenVersion signs the user out of every existing session. A
    // password reset that leaves old sessions alive is not a real reset.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async issueSession(userId: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { workerProfile: { select: { id: true } } },
    });
    const env = loadEnv();

    const refresh = this.tokens.generateRefreshToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refresh.tokenHash,
        // A new login starts a new family. Rotation only ever continues an
        // existing family; it never merges with another device's session.
        familyId: randomUUID(),
        expiresAt,
      },
    });

    return {
      user: toSelfUser(user),
      accessToken: this.tokens.signAccessToken({
        sub: user.id,
        platformRole: user.platformRole,
        tokenVersion: user.tokenVersion,
      }),
      refreshToken: refresh.token,
      refreshTokenExpiresAt: expiresAt,
    };
  }
}
