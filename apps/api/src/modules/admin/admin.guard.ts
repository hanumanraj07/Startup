import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ForbiddenError } from '../../common/errors';
import type { RequestUser } from '../auth/decorators/current-user.decorator';

/**
 * docs/15-admin-panel.md: "`platform_role = ADMIN`, granted only by direct
 * database action, never through a self-service path." This guard runs
 * AFTER JwtAuthGuard (global, so `request.user` is already populated and
 * fresh from the database — see jwt-auth.guard.ts) and simply refuses
 * anything but an admin. "Hiding navigation is not access control": every
 * `/admin` route in this codebase carries this guard, not just the web app's
 * navigation.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user: RequestUser }>();
    if (request.user?.platformRole !== 'ADMIN') {
      throw new ForbiddenError('Admin access required.');
    }
    return true;
  }
}
