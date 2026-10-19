import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';
import { UnauthenticatedError } from '../../common/errors';
import { resetEnvCache } from '../../config/env';

/** Narrows away undefined in a test, failing loudly instead of with a non-null assertion. */
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value");
  return value;
}

/**
 * Refresh-token rotation and reuse detection. The regression this guards:
 * two tabs restoring a session at the same moment present the same refresh
 * cookie; the second one used to look like a stolen token, which burned the
 * whole family and signed the user out everywhere. A rotated token presented
 * again within the grace window is a benign duplicate; the same token later,
 * or a token revoked by logout, is still treated as theft.
 */

const BASE_ENV = {
  DATABASE_URL: 'postgresql://onsite:onsite@localhost:5432/onsite_app',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_BUCKET: 'onsite-media',
  STORAGE_ACCESS_KEY: 'x',
  STORAGE_SECRET_KEY: 'y',
  REFRESH_REUSE_GRACE_SECONDS: '30',
};

interface Row {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

function setup() {
  const rows: Row[] = [];
  let seq = 0;
  const refreshToken = {
    findUnique: async ({ where }: { where: { tokenHash?: string; id?: string } }) =>
      rows.find((r) => (where.tokenHash ? r.tokenHash === where.tokenHash : r.id === where.id)) ?? null,
    create: async ({ data }: { data: Omit<Row, 'id' | 'revokedAt' | 'replacedById'> }) => {
      const row: Row = { id: `rt-${++seq}`, revokedAt: null, replacedById: null, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = must(rows.find((r) => r.id === where.id));
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: { familyId: string; revokedAt: null }; data: Partial<Row> }) => {
      const hit = rows.filter((r) => r.familyId === where.familyId && r.revokedAt === null);
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  };
  const user = {
    id: 'u1',
    email: 'u1@example.com',
    displayName: 'U One',
    status: 'ACTIVE',
    platformRole: 'USER',
    tokenVersion: 0,
    verificationLevel: 1,
    workerProfile: null,
    createdAt: new Date(),
  };
  const prisma = {
    refreshToken,
    user: { findUnique: async () => user },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({ refreshToken }),
  };
  let tokenSeq = 0;
  const tokens = {
    hashOpaqueToken: (t: string) => `hash:${t}`,
    generateRefreshToken: () => {
      const token = `tok-${++tokenSeq}`;
      return { token, tokenHash: `hash:${token}` };
    },
    signAccessToken: () => 'access-token',
  };
  const service = new AuthService(prisma as never, {} as never, tokens as never, {} as never, {} as never);

  const seed = (token: string) =>
    refreshToken.create({
      data: { userId: 'u1', tokenHash: `hash:${token}`, familyId: 'fam-1', expiresAt: new Date(Date.now() + 86_400_000) },
    });
  return { service, rows, seed };
}

beforeEach(() => {
  resetEnvCache();
  process.env = { ...process.env, ...BASE_ENV };
});

describe('AuthService.refresh — rotation and reuse', () => {
  it('rotates: the presented token is retired and a new one issued', async () => {
    const { service, rows, seed } = setup();
    await seed('first');
    const result = await service.refresh('first');
    expect(result.refreshToken).toBe('tok-1');
    expect(rows.find((r) => r.tokenHash === 'hash:first')?.revokedAt).not.toBeNull();
  });

  it('treats the same token presented twice in quick succession as two tabs, not theft', async () => {
    const { service, rows, seed } = setup();
    await seed('shared-cookie');
    await service.refresh('shared-cookie'); // tab A
    const second = await service.refresh('shared-cookie'); // tab B, a moment later
    expect(second.accessToken).toBe('access-token');
    // Nothing in the family was burned: both issued tokens are still live.
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(2);
  });

  it('still burns the family when a rotated token is replayed after the grace window', async () => {
    const { service, rows, seed } = setup();
    await seed('old');
    await service.refresh('old');
    const old = must(rows.find((r) => r.tokenHash === 'hash:old'));
    old.revokedAt = new Date(Date.now() - 60_000);
    await expect(service.refresh('old')).rejects.toThrow(UnauthenticatedError);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('does not revive a token that was revoked by signing out', async () => {
    const { service, seed } = setup();
    await seed('signed-out');
    await service.logout('signed-out');
    await expect(service.refresh('signed-out')).rejects.toThrow(UnauthenticatedError);
  });
});
