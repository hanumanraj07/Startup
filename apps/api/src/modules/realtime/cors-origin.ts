/**
 * Whether a WebSocket handshake's Origin header is allowed, mirroring
 * main.ts's REST CORS policy: an explicit allow-list, never a wildcard with
 * credentials. `origin` is `undefined` for a same-origin or non-browser
 * client (curl, a native app, server-to-server), which is allowed exactly
 * like the REST API's own CORS middleware treats a missing Origin header.
 *
 * Pure and tested directly — see realtime.gateway.ts's comment on the bug
 * this replaced: a callback-shaped `cors.origin` function that never calls
 * its callback hangs the entire handshake with no error anywhere, and no
 * amount of testing this function in isolation would have caught THAT
 * failure mode. What this test file guards is the actual allow/deny
 * decision, so at least the logic itself cannot silently regress.
 */
export function isAllowedOrigin(origin: string | undefined, webUrl: string): boolean {
  return !origin || origin === webUrl;
}
