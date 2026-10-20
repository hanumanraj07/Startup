import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type IORedis from 'ioredis';
import { TooManyAttemptsError } from '../../common/errors';
import { createFastFailConnection } from '../../queue/redis-connection';

/** Wrong passwords allowed before an account starts waiting between attempts. */
export const FREE_FAILURES = 5;
/** The wait after the first failure past the free ones; it doubles with each further failure. */
const FIRST_WAIT_MS = 60_000;
/** The longest an account ever waits. */
const MAX_WAIT_MS = 60 * 60_000;
/** Failures are forgotten after this long without another. */
const FAILURE_MEMORY_MS = 60 * 60_000;

/**
 * Brute-force protection keyed by the account, counting failures only
 * (docs/22, #7). The old limit was 5 sign-ins per 15 minutes per IP, and
 * Indian mobile networks put thousands of phones behind one public IP, so a
 * few people mistyping a password on one tower locked out everyone on it.
 *
 * Now each email gets FREE_FAILURES wrong passwords, then waits 1 minute, 2,
 * 4 … up to an hour before the next try; a correct password clears it. A
 * successful sign-in never counts. The same rule applies to an address with
 * no account, so the lock reveals nothing about which addresses exist. The
 * per-IP limit stays only as a loose flood guard.
 *
 * Fails open: if Redis is unreachable, sign-in is not blocked by this (the
 * password check still runs, and the argon2 cost still slows guessing).
 */
@Injectable()
export class LoginAttemptsService implements OnModuleDestroy {
  private readonly logger = new Logger(LoginAttemptsService.name);
  private redisClient: IORedis | null = null;

  private get redis(): IORedis {
    this.redisClient ??= createFastFailConnection();
    return this.redisClient;
  }

  /** Throws if this account must wait before its next attempt. */
  async assertMayTry(email: string): Promise<void> {
    let waitMs: number;
    try {
      waitMs = await this.redis.pttl(lockKey(email));
    } catch (error) {
      this.logger.warn(`Login lock check skipped (Redis unavailable): ${String(error)}`);
      return;
    }
    if (waitMs > 0) {
      const minutes = Math.ceil(waitMs / 60_000);
      throw new TooManyAttemptsError(
        `Too many incorrect attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.`,
        { retryAfterSeconds: Math.ceil(waitMs / 1000) },
      );
    }
  }

  async recordFailure(email: string): Promise<void> {
    try {
      const result = await this.redis
        .multi()
        .incr(failKey(email))
        .pexpire(failKey(email), FAILURE_MEMORY_MS)
        .exec();
      const failures = Number(result?.[0]?.[1] ?? 0);
      if (failures > FREE_FAILURES) {
        await this.redis.set(lockKey(email), '1', 'PX', waitAfter(failures));
      }
    } catch (error) {
      this.logger.warn(`Login failure not counted (Redis unavailable): ${String(error)}`);
    }
  }

  async recordSuccess(email: string): Promise<void> {
    try {
      await this.redis.del(failKey(email), lockKey(email));
    } catch (error) {
      this.logger.warn(`Login failures not cleared (Redis unavailable): ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redisClient?.quit().catch(() => undefined);
  }
}

/** 1 minute after the first failure past the free ones, doubling, capped at MAX_WAIT_MS. */
export function waitAfter(failures: number): number {
  const over = Math.max(1, failures - FREE_FAILURES);
  return Math.min(FIRST_WAIT_MS * 2 ** (over - 1), MAX_WAIT_MS);
}

function failKey(email: string): string {
  return `login:fail:${email.trim().toLowerCase()}`;
}

function lockKey(email: string): string {
  return `login:lock:${email.trim().toLowerCase()}`;
}
