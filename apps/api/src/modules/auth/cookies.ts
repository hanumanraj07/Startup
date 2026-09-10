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
 * KNOWN GAP, recorded here and in ai/memory.md: web and api run on different
 * origins (localhost:3000 vs localhost:4000) in this setup. sameSite=lax
 * cookies are not sent on a cross-origin fetch/XHR, only on top-level
 * navigation. The API itself is correct and this is verified with curl (which
 * does not enforce SameSite), but the browser-facing web app will need either
 * a same-site production deployment (api.onsite.app + onsite.app is
 * cross-subdomain, not cross-site, once cookies are scoped appropriately) or
 * a same-origin proxy (Next.js rewrites) before login works from the browser.
 * That wiring belongs to whichever phase builds the web app's auth pages.
 */
function cookieOptions(maxAgeMs: number): CookieOptions {
  const env = loadEnv();
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
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
