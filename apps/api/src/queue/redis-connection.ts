import { Logger } from '@nestjs/common';
import IORedis from 'ioredis';
import { loadEnv } from '../config/env';

const logger = new Logger('Redis');

/**
 * Without an 'error' listener ioredis prints "Unhandled error event" with a
 * full stack trace for every failed reconnect attempt, many per second while
 * Redis is down. Found live while testing the fail-open limiter (docs/22,
 * #21). One line per connection per minute says the same thing.
 */
function withQuietErrors(redis: IORedis, label: string): IORedis {
  let lastLoggedAt = 0;
  redis.on('error', (error: Error) => {
    if (Date.now() - lastLoggedAt < 60_000) return;
    lastLoggedAt = Date.now();
    logger.warn(`${label} connection error (retrying): ${error.message}`);
  });
  return redis;
}

/**
 * The Redis connection BullMQ uses for the auto-approve delayed job.
 *
 * `maxRetriesPerRequest: null` is a hard BullMQ requirement, not a style
 * choice — BullMQ manages its own retry and blocking-command semantics, and
 * ioredis's own retry limit fights with that if left at its default.
 *
 * This is deliberately the ONLY thing in the auto-approval design that
 * depends on Redis. The sweeper in sweeper.service.ts is a plain
 * `setInterval` against Postgres with no Redis dependency at all, precisely
 * so a Redis outage cannot take down both the fast path and the guarantee
 * meant to catch the fast path's failure. See ai/memory.md.
 */
export function createBullConnection(): IORedis {
  const env = loadEnv();
  return withQuietErrors(new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }), 'Queue');
}

/**
 * Bounds a BullMQ call made inside a user's request. BullMQ's connection
 * waits for Redis forever, so with Redis down, publishing a task or
 * submitting work would hang on its queue.add (docs/22, #17, #21). Every
 * producer is best-effort with a database-backed sweep behind it, so giving
 * up after a moment is safe; the call may still land later.
 */
export function withTimeout<T>(promise: Promise<T>, ms = 1_500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms} ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * For checks on the request path (rate limits, sign-in lockouts), which must
 * fail open rather than wait (docs/22, #21). The BullMQ connection above
 * queues commands while Redis is down and waits for it forever, so every
 * request would hang behind it. This one refuses at once when disconnected
 * and gives up on a slow command, so the caller can let the request through.
 */
export function createFastFailConnection(): IORedis {
  const env = loadEnv();
  return withQuietErrors(
    new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: 500,
      connectTimeout: 2_000,
    }),
    'Request-path',
  );
}
