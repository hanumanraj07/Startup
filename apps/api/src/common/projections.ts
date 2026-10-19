import type { User } from '@prisma/client';
import type { PublicUser, PublicWorker, SelfUser } from '@onsite/types';

/**
 * Every response in this codebase is built from a projection, never a raw
 * Prisma entity. See ai/architecture-rules.md.
 *
 * These are the shapes that matter most: PublicUser is what one marketplace
 * party is ever allowed to see of another (no email, phone, address, or
 * coordinates); SelfUser is what an account sees of itself; PublicWorker
 * extends PublicUser with the trust-page figures docs/19-ui-design-system.md
 * asks for — "shown separately, never collapsed into one opaque score."
 */

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    homeCity: user.homeCity,
    verificationLevel: user.verificationLevel as PublicUser['verificationLevel'],
    memberSince: user.createdAt.toISOString(),
  };
}

export function toPublicWorker(
  user: User,
  workerProfile: { ratingAvg: number | null; ratingCount: number; tasksCompleted: number; completionRate: number | null },
): PublicWorker {
  return {
    ...toPublicUser(user),
    ratingAvg: workerProfile.ratingAvg,
    ratingCount: workerProfile.ratingCount,
    tasksCompleted: workerProfile.tasksCompleted,
    completionRate: workerProfile.completionRate,
  };
}

export function toSelfUser(user: User & { workerProfile?: { id: string } | null }): SelfUser {
  return {
    ...toPublicUser(user),
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    phone: user.phone,
    phoneVerified: user.phoneVerifiedAt !== null,
    platformRole: user.platformRole,
    status: user.status,
    hasWorkerProfile: Boolean(user.workerProfile),
  };
}

/**
 * Reduces a full street address to its locality, so a worker browsing the
 * open feed (or an incoming request) learns roughly where a task is without
 * learning exactly where until they accept it. A PIN code narrows an address
 * to a few streets and says nothing a worker can picture, so it is dropped
 * before taking the last two named parts.
 */
export function approximateAddress(address: string): string {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !/^\d{6}$/.test(p));
  return parts.length <= 2 ? parts.join(', ') : parts.slice(-2).join(', ');
}
