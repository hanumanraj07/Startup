import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { loadEnv } from '../../config/env';

/** What goes into a signed access token. Kept minimal and re-checked against the database on every request. */
export interface AccessTokenPayload {
  sub: string;
  platformRole: 'USER' | 'ADMIN';
  tokenVersion: number;
}

/**
 * Access tokens (short-lived JWTs) and refresh tokens (opaque, hashed at
 * rest), plus the composite-token pattern used for email verification and
 * password reset links.
 *
 * Refresh tokens are never JWTs. A JWT can be inspected and its claims read
 * without the server; an opaque random string reveals nothing and the server
 * is the only place that can turn it back into a user. See
 * docs/16-security-requirements.md.
 */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccessToken(payload: AccessTokenPayload): string {
    const env = loadEnv();
    return this.jwt.sign(payload, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: env.JWT_ACCESS_TTL,
    });
  }

  /** Throws if the signature is invalid or the token has expired. */
  verifyAccessToken(token: string): AccessTokenPayload {
    const env = loadEnv();
    return this.jwt.verify<AccessTokenPayload>(token, { secret: env.JWT_ACCESS_SECRET });
  }

  /** A new opaque refresh token, plus the hash that is actually stored. */
  generateRefreshToken(): { token: string; tokenHash: string } {
    const token = randomBytes(48).toString('base64url');
    return { token, tokenHash: this.hashOpaqueToken(token) };
  }

  /**
   * SHA-256 of an opaque token. Deliberately not a keyed hash: the token
   * itself already has 384 bits of entropy from a CSPRNG, so a lookup hash is
   * enough. Comparison against a stored hash should still go through
   * `constantTimeEqual`, since a timing difference on a byte-string compare
   * technically confirms nothing here but costs nothing to close off.
   */
  hashOpaqueToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  constantTimeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  /**
   * Packs a link token as `<rowId>.<secret>`, so the row backing an email
   * verification or password reset link can be found by primary key instead
   * of scanning every unconsumed row for a hash match. The secret half is
   * still hashed at rest and compared like any other credential.
   */
  packLinkToken(rowId: string, secret: string): string {
    return `${rowId}.${secret}`;
  }

  unpackLinkToken(token: string): { rowId: string; secret: string } | null {
    const i = token.indexOf('.');
    if (i <= 0 || i === token.length - 1) return null;
    return { rowId: token.slice(0, i), secret: token.slice(i + 1) };
  }

  generateLinkSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  generateNumericOtp(digits = 6): string {
    const max = 10 ** digits;
    // randomBytes rather than Math.random: OTPs gate account actions and must
    // come from a CSPRNG, not a predictable generator.
    const n = randomBytes(4).readUInt32BE(0) % max;
    return n.toString().padStart(digits, '0');
  }
}
