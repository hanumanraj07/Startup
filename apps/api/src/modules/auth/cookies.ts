import type { CookieOptions, Response } from 'express';
import { loadEnv } from '../../config/env';

export const REFRESH_COOKIE_NAME = 'onsite_rt';

/**
 * Refresh token cookie options.
 *
 * httpOnly so JavaScript can never read it — the whole point of keeping the
 * refresh token out of a JS-accessible store. `secure` is tied to NODE_ENV
 * rather than hardcoded true, because the Secure attribute requires HTTPS and
 * local development runs over plain http.
 *
 * Web and API run on different registrable domains in this deployment
 * (onsite-orcin.vercel.app vs onsite-api.duckdns.org) — genuinely cross-site,
 * not just cross-origin-same-site. sameSite=lax cookies are never sent on a
 * cross-site fetch/XHR, only on top-level navigation, which silently broke
 * `/auth/refresh` from the browser (curl doesn't enforce SameSite, so this
 * was invisible to every curl-based verification this project has relied on
 * — only a real browser session caught it). sameSite=none is required for a
 * cross-site cookie to be sent at all, which in turn requires secure=true
 * (browsers reject `SameSite=None` without `Secure`) — both already true in
 * production since this backend only serves HTTPS there. Local dev keeps
 * sameSite=lax: web and api are same-site there (both localhost), and lax is
 * the safer default when none is not needed.
 */
function cookieOptions(maxAgeMs: number): CookieOptions {
  const env = loadEnv();
  const isProduction = env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/v1/auth',
    maxAge: maxAgeMs,
  };
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, cookieOptions(expiresAt.getTime() - Date.now()));
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
}
