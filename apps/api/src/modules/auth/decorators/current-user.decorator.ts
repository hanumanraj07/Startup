import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** The record JwtAuthGuard attaches to the request after a fresh database check. */
export interface RequestUser {
  id: string;
  platformRole: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  verificationLevel: number;
  hasWorkerProfile: boolean;
}

/** `@CurrentUser() user: RequestUser` in any controller behind the auth guard. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestUser => {
  const request = ctx.switchToHttp().getRequest<Request & { user: RequestUser }>();
  return request.user;
});
