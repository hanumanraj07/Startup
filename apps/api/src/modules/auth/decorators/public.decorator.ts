import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as not requiring authentication.
 *
 * The default is the opposite: every endpoint requires a valid access token
 * unless explicitly opted out with this decorator. Secure by default, per
 * ai/architecture-rules.md — a route added later without this decorator is
 * locked, not open.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
