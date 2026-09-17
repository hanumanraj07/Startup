import { Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { UnauthenticatedError } from '../../common/errors';
import { loadEnv } from '../../config/env';

export interface GoogleProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Verifies a Google ID token — the browser-side "Sign in with Google" flow
 * hands the frontend a signed JWT directly; this is the only place that
 * token is trusted, and only after `verifyIdToken` has checked its
 * signature against Google's public keys, its expiry, its issuer, and that
 * its audience is genuinely this app's own client id (never accepted from
 * the client, per docs/16-security-requirements.md's pattern of never
 * trusting a client's account of its own identity).
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  private client(): OAuth2Client {
    const env = loadEnv();
    if (!env.GOOGLE_CLIENT_ID) {
      throw new Error('Google sign-in is not configured. Set GOOGLE_CLIENT_ID.');
    }
    return new OAuth2Client(env.GOOGLE_CLIENT_ID);
  }

  async verifyIdToken(idToken: string): Promise<GoogleProfile> {
    const env = loadEnv();
    const client = this.client();

    // google-auth-library throws a plain Error on anything from "malformed
    // token" to "expired" to "wrong audience" — none of that detail is safe
    // or useful to hand back to a client, so it's collapsed into the same
    // generic, user-facing UnauthenticatedError every other login failure in
    // this codebase produces. The real reason still reaches the server log.
    const payload = await client
      .verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID })
      .then((ticket) => ticket.getPayload())
      .catch((error) => {
        this.logger.warn(`Google ID token verification failed: ${String(error)}`);
        throw new UnauthenticatedError('Could not verify that Google sign-in. Try again.');
      });

    if (!payload?.sub || !payload.email) {
      throw new UnauthenticatedError('Google did not return a usable identity.');
    }

    return {
      googleId: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified ?? false,
      displayName: payload.name ?? payload.email.split('@')[0] ?? payload.email,
      avatarUrl: payload.picture ?? null,
    };
  }
}
