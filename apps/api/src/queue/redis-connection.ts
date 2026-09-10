import IORedis from 'ioredis';
import { loadEnv } from '../config/env';

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
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
