import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../common/errors';
import { resetEnvCache } from '../../config/env';
import { MockVerificationProvider } from './mock.provider';
import type { AccountCheck } from './verification.provider';
import { decideAccount, IDENTITY_ATTEMPTS_PER_DAY, VerificationService } from './verification.service';

beforeEach(() => {
  resetEnvCache();
  process.env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://onsite:onsite@localhost:5432/onsite_app',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    STORAGE_ENDPOINT: 'http://localhost:9000',
    STORAGE_BUCKET: 'onsite-media',
    STORAGE_ACCESS_KEY: 'x',
    STORAGE_SECRET_KEY: 'y',
  };
});

const valid = (nameAtBank: string | null, providerNameMatch: AccountCheck['providerNameMatch'] = null): AccountCheck => ({
  outcome: 'VALID',
  nameAtBank,
  bankName: 'TEST BANK',
  providerNameMatch,
  reference: 'ref',
  reason: null,
});

describe('decideAccount', () => {
  it('verifies an account in the verified person’s name', () => {
    expect(decideAccount(valid('RAHUL KUMAR SHARMA'), 'Rahul Sharma').status).toBe('VERIFIED');
  });

  it('refuses an account in someone else’s name', () => {
    const decision = decideAccount(valid('PRIYA VERMA'), 'Rahul Sharma');
    expect(decision.status).toBe('NAME_MISMATCH');
    expect(decision.reason).toContain('PRIYA VERMA');
  });

  it('trusts the provider’s own name verdict when it gives one', () => {
    expect(decideAccount(valid('R K SHARMA', 'PARTIAL'), 'Rahul Sharma').status).toBe('VERIFIED');
    expect(decideAccount(valid('RAHUL SHARMA', 'MISMATCH'), 'Rahul Sharma').status).toBe('NAME_MISMATCH');
  });

  it('fails an account the bank says is invalid, with the reason', () => {
    const decision = decideAccount(
      { outcome: 'INVALID', nameAtBank: null, bankName: null, providerNameMatch: null, reference: null, reason: 'No such account.' },
      'Rahul Sharma',
    );
    expect(decision).toEqual({ status: 'FAILED', reason: 'No such account.' });
  });

  it('never fails an account because the provider could not be reached', () => {
    const decision = decideAccount(
      { outcome: 'UNAVAILABLE', nameAtBank: null, bankName: null, providerNameMatch: null, reference: null, reason: 'Try later.' },
      'Rahul Sharma',
    );
    expect(decision.status).toBe('PENDING');
  });

  it('holds a valid account with no name to compare for a manual check', () => {
    expect(decideAccount(valid(null), 'Rahul Sharma').status).toBe('PENDING');
  });
});

function build(options: { level?: number; attempts?: number; provider?: MockVerificationProvider | null } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ verificationLevel: options.level ?? 1, displayName: 'Rahul S.' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    identityVerification: {
      count: vi.fn().mockResolvedValue(options.attempts ?? 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: '0190f3a2-1111-7000-8000-000000000001', status: 'PENDING', method: 'DIGILOCKER', createdAt: new Date(), completedAt: null, verifiedName: null, documentLast4: null, failureReason: null, ...data };
        rows.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...rows.get(where.id), ...data };
        rows.set(where.id, row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        const row = rows.get(where.id);
        if (!row || row.status !== where.status) return { count: 0 };
        rows.set(where.id, { ...row, ...data });
        return { count: 1 };
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
        const row = rows.get(where.id);
        return row && row.userId === where.userId ? row : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id)),
    },
  };
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const provider = options.provider === undefined ? new MockVerificationProvider() : options.provider;
  const service = new VerificationService(prisma as never, notifications as never, audit as never, {} as never, provider);
  return { service, prisma, notifications, audit, rows };
}

describe('VerificationService identity', () => {
  it('starts a DigiLocker session and returns where to send the user', async () => {
    const { service } = build();
    const session = await service.startIdentity('user-1');
    expect(session.url).toContain('/kyc/digilocker-test?session=');
    expect(session.sessionId).toBeTruthy();
  });

  it('raises the user to level 2, audits and notifies once the government record is shared', async () => {
    const { service, prisma, audit, notifications } = build();
    const { sessionId } = await service.startIdentity('user-1');
    const view = await service.completeTestIdentity('user-1', sessionId, { allow: true, name: 'Rahul Sharma' });
    expect(view.status).toBe('VERIFIED');
    expect(view.verifiedName).toBe('Rahul Sharma');
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', verificationLevel: { lt: 2 } },
      data: { verificationLevel: 2 },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'IDENTITY_VERIFIED' }));
    expect(notifications.notify).toHaveBeenCalledWith('user-1', { event: 'KYC_APPROVED' });
  });

  it('records a refusal without changing the user’s level', async () => {
    const { service, prisma } = build();
    const { sessionId } = await service.startIdentity('user-1');
    const view = await service.completeTestIdentity('user-1', sessionId, { allow: false, name: 'Rahul Sharma' });
    expect(view.status).toBe('CONSENT_DENIED');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('records the outcome only once, even if completed twice', async () => {
    const { service, prisma } = build();
    const { sessionId } = await service.startIdentity('user-1');
    await service.completeTestIdentity('user-1', sessionId, { allow: true, name: 'Rahul Sharma' });
    await service.completeTestIdentity('user-1', sessionId, { allow: false, name: 'Someone Else' });
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('caps attempts per day and points to the manual check', async () => {
    const { service } = build({ attempts: IDENTITY_ATTEMPTS_PER_DAY });
    await expect(service.startIdentity('user-1')).rejects.toThrow(BusinessRuleError);
  });

  it('does not start a second verification for an already verified user', async () => {
    const { service } = build({ level: 2 });
    await expect(service.startIdentity('user-1')).rejects.toThrow(ConflictError);
  });

  it('says plainly when there is no provider, instead of pretending', async () => {
    const { service } = build({ provider: null });
    await expect(service.startIdentity('user-1')).rejects.toThrow(/manual check/);
  });

  it('hides the test consent route unless the mock provider is active', async () => {
    const { service } = build({ provider: null });
    await expect(service.completeTestIdentity('user-1', 'x', { allow: true, name: 'Rahul Sharma' })).rejects.toThrow(
      NotFoundError,
    );
  });
});
