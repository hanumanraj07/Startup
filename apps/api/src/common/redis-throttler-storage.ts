import type { ThrottlerStorage } from '@nestjs/throttler';
import { createBullConnection } from '../queue/redis-connection';

/**
 * Mirrors `@nestjs/throttler`'s internal `ThrottlerStorageRecord` shape,
 * which the package does not re-export from its public entry point (only
 * `ThrottlerStorage`, the interface this class implements, is exported).
 */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * docs/16-security-requirements.md: "Rate limit state lives in Redis so
 * limits hold across API replicas rather than per-instance." The default
 * `@nestjs/throttler` storage is an in-memory Map, which is correct for a
 * single process and silently wrong the moment there is more than one API
 * replica — each replica would enforce its own separate limit, so a client
 * split across two replicas by a load balancer gets `limit × replicas`
 * requests through before anything blocks it.
 *
 * Not perfectly atomic: `INCR` then `PEXPIRE` (only on the first hit) is two
 * round trips, not one Lua script. The tiny window between them could in
 * theory let a key survive without an expiry if the process crashed between
 * the two calls, which would fail open (too permissive), never fail closed —
 * an acceptable trade for this codebase's scale, and honestly documented
 * rather than dressed up as atomic.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly redis = createBullConnection();

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;

    const blockPttl = await this.redis.pttl(blockKey);
    if (blockPttl > 0) {
      return { totalHits: limit + 1, timeToExpire: 0, isBlocked: true, timeToBlockExpire: Math.ceil(blockPttl / 1000) };
    }

    const totalHits = await this.redis.incr(hitKey);
    if (totalHits === 1) {
      await this.redis.pexpire(hitKey, ttl);
    }
    const hitPttl = await this.redis.pttl(hitKey);
    const timeToExpire = Math.ceil(Math.max(hitPttl, 0) / 1000);

    if (totalHits > limit) {
      const effectiveBlockMs = blockDuration > 0 ? blockDuration : ttl;
      await this.redis.set(blockKey, '1', 'PX', effectiveBlockMs);
      return { totalHits, timeToExpire, isBlocked: true, timeToBlockExpire: Math.ceil(effectiveBlockMs / 1000) };
    }

    return { totalHits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
  }
}
