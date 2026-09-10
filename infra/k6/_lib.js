// Shared helpers for the k6 scripts in this directory. k6 runs scripts in a
// goja VM, not Node — no npm imports, ES module syntax only, and no access
// to Node built-ins (no `crypto`, no `fs`). JWT signing is therefore done by
// hand with k6's built-in `crypto` module (HMAC-SHA256), not a library.

import crypto from 'k6/crypto';
import encoding from 'k6/encoding';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const JWT_ACCESS_SECRET = __ENV.JWT_ACCESS_SECRET;

if (!JWT_ACCESS_SECRET) {
  throw new Error('Set JWT_ACCESS_SECRET to the target environment\'s real secret before running.');
}

function base64url(input) {
  return encoding.b64encode(input, 'rawurl');
}

/** Mints a real, verifiable access token — same shape TokenService.signAccessToken produces. */
export function mintToken(userId, platformRole = 'USER', tokenVersion = 0) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      sub: userId,
      platformRole,
      tokenVersion,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 15 * 60,
    }),
  );
  const signature = crypto.hmac('sha256', JWT_ACCESS_SECRET, `${header}.${payload}`, 'base64rawurl');
  return `${header}.${payload}.${signature}`;
}

export function authHeaders(token, extraHeaders = {}) {
  return {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
  };
}

export { BASE_URL };
