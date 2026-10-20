import { describe, expect, it, vi } from 'vitest';
import { TooManyAttemptsError } from '../../common/errors';
import { FREE_FAILURES, LoginAttemptsService, waitAfter } from './login-attempts.service';

/** docs/22, #7: wrong passwords are limited per account, not per (shared) IP. */

/** An in-memory stand-in for the few Redis commands the service uses. */
function fakeRedis() {
  const values = new Map<string, number>();
  const expiries = new Map<string, number>();
  const redis = {
    values,
    pttl: vi.fn(async (key: string) => (values.has(key) ? (expiries.get(key) ?? -1) : -2)),
    set: vi.fn(async (key: string, _v: string, _px: string, ms: number) => {
      values.set(key, 1);
      expiries.set(key, ms);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => keys.forEach((k) => values.delete(k))),
    multi: vi.fn(() => {
      const ops: (() => unknown)[] = [];
      const chain = {
        incr: (key: string) => {
          ops.push(() => {
            values.set(key, (values.get(key) ?? 0) + 1);
            return values.get(key);
          });
          return chain;
        },
        pexpire: (key: string, ms: number) => {
          ops.push(() => expiries.set(key, ms) && 1);
          return chain;
        },
        exec: async () => ops.map((op) => [null, op()]),
      };
      return chain;
    }),
  };
  return redis;
}

function build(redis: unknown) {
  const service = new LoginAttemptsService();
  (service as unknown as { redisClient: unknown }).redisClient = redis;
  return service;
}

describe('waitAfter', () => {
  it('starts at a minute after the free failures, doubles, and stops at an hour', () => {
    expect(waitAfter(FREE_FAILURES + 1)).toBe(60_000);
    expect(waitAfter(FREE_FAILURES + 2)).toBe(120_000);
    expect(waitAfter(FREE_FAILURES + 3)).toBe(240_000);
    expect(waitAfter(FREE_FAILURES + 20)).toBe(60 * 60_000);
  });
});

describe('LoginAttemptsService', () => {
  it('lets an account fail a few times, then makes it wait', async () => {
    const service = build(fakeRedis());

    for (let i = 0; i < FREE_FAILURES; i++) {
      await service.assertMayTry('a@example.com');
      await service.recordFailure('a@example.com');
    }
    await expect(service.assertMayTry('a@example.com')).resolves.toBeUndefined();

    await service.recordFailure('a@example.com');
    await expect(service.assertMayTry('a@example.com')).rejects.toThrow(TooManyAttemptsError);
  });

  it('keys by the account, so other people on the same network are unaffected', async () => {
    const service = build(fakeRedis());
    for (let i = 0; i <= FREE_FAILURES; i++) await service.recordFailure('mistyper@example.com');

    await expect(service.assertMayTry('mistyper@example.com')).rejects.toThrow(TooManyAttemptsError);
    await expect(service.assertMayTry('neighbour@example.com')).resolves.toBeUndefined();
  });

  it('treats the address case-insensitively', async () => {
    const service = build(fakeRedis());
    for (let i = 0; i <= FREE_FAILURES; i++) await service.recordFailure('A@Example.com');

    await expect(service.assertMayTry('a@example.com')).rejects.toThrow(TooManyAttemptsError);
  });

  it('a correct password clears the count', async () => {
    const redis = fakeRedis();
    const service = build(redis);
    for (let i = 0; i < FREE_FAILURES; i++) await service.recordFailure('a@example.com');

    await service.recordSuccess('a@example.com');
    await service.recordFailure('a@example.com');
    await expect(service.assertMayTry('a@example.com')).resolves.toBeUndefined();
  });

  it('fails open when Redis is unreachable', async () => {
    const down = () => Promise.reject(new Error("Stream isn't writeable"));
    const service = build({ pttl: down, set: down, del: down, multi: () => ({ incr() { return this; }, pexpire() { return this; }, exec: down }) });

    await expect(service.assertMayTry('a@example.com')).resolves.toBeUndefined();
    await expect(service.recordFailure('a@example.com')).resolves.toBeUndefined();
  });
});
