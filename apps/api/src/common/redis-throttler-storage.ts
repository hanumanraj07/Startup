import type { ThrottlerStorage } from '@nestjs/throttler';
import { Logger } from '@nestjs/common';
import { createFastFailConnection } from '../queue/redis-connection';

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
 * The count and its expiry are set in one MULTI (`PEXPIRE … NX`), so a
 * request dying between them can no longer leave a counter with no expiry,
 * which used to become a permanent block (docs/22, #21).
 *
 * Fails open: with Redis unreachable, requests are let through and a warning
 * logged, instead of every request in the app failing or hanging behind the
 * rate limiter. The connection refuses at once when disconnected.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis = createFastFailConnection();
  private lastWarnedAt = 0;

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;

    let blockPttl: number;
    let totalHits: number;
    let hitPttl: number;
    try {
      const result = await this.redis
        .multi()
        .pttl(blockKey)
        .incr(hitKey)
        .pexpire(hitKey, ttl, 'NX')
        .pttl(hitKey)
        .exec();
      blockPttl = Number(result?.[0]?.[1] ?? -2);
      totalHits = Number(result?.[1]?.[1] ?? 0);
      hitPttl = Number(result?.[3]?.[1] ?? 0);
    } catch (error) {
      if (Date.now() - this.lastWarnedAt > 60_000) {
        this.lastWarnedAt = Date.now();
        this.logger.warn(`Rate limiting skipped, Redis unavailable: ${String(error)}`);
      }
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }

    if (blockPttl > 0) {
      return { totalHits: limit + 1, timeToExpire: 0, isBlocked: true, timeToBlockExpire: Math.ceil(blockPttl / 1000) };
    }
    const timeToExpire = Math.ceil(Math.max(hitPttl, 0) / 1000);

    if (totalHits > limit) {
      const effectiveBlockMs = blockDuration > 0 ? blockDuration : ttl;
      await this.redis.set(blockKey, '1', 'PX', effectiveBlockMs).catch(() => undefined);
      return { totalHits, timeToExpire, isBlocked: true, timeToBlockExpire: Math.ceil(effectiveBlockMs / 1000) };
    }

    return { totalHits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
  }
}
