import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UnauthenticatedError } from '../../../common/errors';
import { PrismaService } from '../../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenService } from '../token.service';

/**
 * Global authentication guard. Every route requires a valid access token
 * unless marked @Public().
 *
 * The JWT signature and expiry are checked first, cheaply. Then — and this is
 * the part that matters — the user's current status, verification level and
 * token_version are read FRESH from the database, never trusted from the
 * token's claims. A token signed this morning must not still grant access to
 * an account suspended this afternoon. See docs/08-authentication-authorization.md:
 * "Suspension takes effect immediately, not at token expiry."
 *
 * This costs one indexed primary-key lookup per authenticated request. At the
 * scale docs/20-scalability-performance.md targets, that is a rounding error
 * next to the geo queries already benchmarked at ~1ms against 10,000 rows.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) throw new UnauthenticatedError('Sign in to continue.');

    let payload: ReturnType<TokenService['verifyAccessToken']>;
    try {
      payload = this.tokens.verifyAccessToken(token);
    } catch {
      throw new UnauthenticatedError('Your session has expired. Please sign in again.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        platformRole: true,
        status: true,
        verificationLevel: true,
        tokenVersion: true,
        workerProfile: { select: { id: true } },
      },
    });

    if (!user) throw new UnauthenticatedError('Your session is no longer valid.');

    // Bumped on suspension. A token issued before that moment is now stale,
    // regardless of what its own expiry claims.
    if (user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthenticatedError('Your session is no longer valid. Please sign in again.');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthenticatedError('This account is not active.');
    }

    (request as Request & { user: unknown }).user = {
      id: user.id,
      platformRole: user.platformRole,
      status: user.status,
      verificationLevel: user.verificationLevel,
      hasWorkerProfile: user.workerProfile !== null,
    };

    return true;
  }
}
