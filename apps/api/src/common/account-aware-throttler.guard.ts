import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Two extra rate-limit dimensions beyond the default IP-based one, since
 * most of the limits in docs/07-api-specification.md's table are specified
 * per user or per account, not per IP — "Task creation: 20 per hour per
 * user," "Accept: 30 per minute per worker," and so on. Applying them all as
 * IP-based (this codebase's original state) under-protects a single
 * account hitting the API from many IPs, and — the failure this class exists
 * to close, found live while load-testing the accept-herd scenario from
 * docs/20-scalability-performance.md — over-throttles many DIFFERENT users
 * sharing one IP (a NAT, an office, or 50 test workers on one laptop): they
 * would all draw down one shared bucket instead of each getting their own.
 *
 * **`account`** — keyed by the email or phone in the request body. For
 * unauthenticated, credential-based routes (login, register, password
 * reset, OTP send), where there is no bearer token yet to identify the
 * caller.
 *
 * **`user`** — keyed by the `sub` claim decoded (NOT verified) from the
 * request's Bearer token, for authenticated routes (task creation, accept,
 * payment creation, messages). Decoding without verifying is deliberate and
 * safe for this purpose only: ThrottlerGuard runs before JwtAuthGuard (see
 * app.module.ts's comment — an unauthenticated flood is rate-limited before
 * the JWT guard does any database work), so no verified identity exists yet
 * at this point in the pipeline. A forged token can claim any `sub` it
 * likes and get its own rate-limit bucket for free, but that costs an
 * attacker nothing useful: the forged token still fails real authentication
 * moments later in JwtAuthGuard, exactly as an unrecognized token always
 * would. The unverified claim is trusted only to decide which counter to
 * increment, never to authorize anything.
 *
 * Both dimensions are additive, not substitutional: the route's `default`
 * throttler still enforces its own IP-based limit unmodified, and either
 * dimension exceeding its own limit blocks the request — "whichever binds
 * first," genuinely, not one limit standing in for the other. A request
 * with no identifiable account/user for the relevant dimension falls back
 * to the IP-derived tracker, so it degrades to an IP limit rather than
 * silently exempting itself.
 */
@Injectable()
export class AccountAwareThrottlerGuard extends ThrottlerGuard {
  protected override generateKey(context: ExecutionContext, suffix: string, name: string): string {
    if (name === 'account') {
      const req = context.switchToHttp().getRequest<{ body?: Record<string, unknown> }>();
      const identifier = req.body?.email ?? req.body?.phone;
      const accountSuffix =
        typeof identifier === 'string' && identifier.length > 0 ? identifier.toLowerCase() : suffix;
      return super.generateKey(context, accountSuffix, name);
    }

    if (name === 'user') {
      const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
      const claimedSub = decodeUnverifiedSubject(req.headers?.authorization);
      return super.generateKey(context, claimedSub ?? suffix, name);
    }

    return super.generateKey(context, suffix, name);
  }
}

/** Reads the `sub` claim out of a JWT's payload segment without checking its signature. See the class comment for why that is safe here and only here. */
export function decodeUnverifiedSubject(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader?.startsWith('Bearer ')) return undefined;
  const token = authorizationHeader.slice(7);
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return undefined;

  try {
    const payload: unknown = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));
    const sub = (payload as { sub?: unknown })?.sub;
    return typeof sub === 'string' && sub.length > 0 ? sub : undefined;
  } catch {
    return undefined;
  }
}
