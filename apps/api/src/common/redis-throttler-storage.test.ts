import { describe, expect, it, vi } from 'vitest';
import { RedisThrottlerStorage } from './redis-throttler-storage';

vi.mock('../queue/redis-connection', () => ({ createFastFailConnection: () => ({}) }));

/** docs/22, #21: the limiter must count atomically and never take the app down with Redis. */
function storageWith(exec: () => Promise<unknown>) {
  const storage = new RedisThrottlerStorage();
  const chain = { pttl: () => chain, incr: () => chain, pexpire: vi.fn(() => chain), exec };
  (storage as unknown as { redis: unknown }).redis = { multi: () => chain, set: vi.fn().mockResolvedValue('OK') };
  return { storage, chain };
}

describe('RedisThrottlerStorage', () => {
  it('sets the expiry in the same MULTI as the count, only if none is set yet', async () => {
    const { storage, chain } = storageWith(async () => [[null, -2], [null, 1], [null, 1], [null, 60_000]]);

    const record = await storage.increment('k', 60_000, 10, 0, 'default');

    expect(chain.pexpire).toHaveBeenCalledWith('throttle:default:k', 60_000, 'NX');
    expect(record).toEqual({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 });
  });

  it('blocks above the limit', async () => {
    const { storage } = storageWith(async () => [[null, -2], [null, 11], [null, 0], [null, 30_000]]);

    expect((await storage.increment('k', 60_000, 10, 0, 'default')).isBlocked).toBe(true);
  });

  it('lets the request through when Redis is unreachable, instead of failing every request', async () => {
    const { storage } = storageWith(() => Promise.reject(new Error("Stream isn't writeable and enableOfflineQueue options is false")));

    expect(await storage.increment('k', 60_000, 10, 0, 'default')).toEqual({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 });
  });
});
