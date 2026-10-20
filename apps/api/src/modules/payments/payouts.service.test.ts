import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../../config/env';
import { PayoutsService } from './payouts.service';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://onsite:onsite@localhost:5432/onsite_app',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_BUCKET: 'onsite-media',
  STORAGE_ACCESS_KEY: 'x',
  STORAGE_SECRET_KEY: 'y',
};

beforeEach(() => {
  resetEnvCache();
  process.env = { ...process.env, ...BASE_ENV, NODE_ENV: 'test' };
  delete process.env.PAYOUT_PROVIDER;
});

const account = {
  id: 'acc-1',
  userId: 'w1',
  type: 'BANK',
  accountNumberMasked: '••••••••1234',
  upiVpa: null,
  isVerified: true,
  isDefault: true,
};

function build(options: { payoutStatus?: string; claimCount?: number; accountTail?: string; taskStatus?: string } = {}) {
  const payout = {
    id: 'po-1',
    taskId: 't1',
    workerId: 'w1',
    amountPaise: 112_000n,
    kind: 'EARNINGS',
    reimbursementPaise: 95_000n,
    status: options.payoutStatus ?? 'PENDING',
    attempts: 0,
    task: { title: 'Bring a charger', status: options.taskStatus ?? 'COMPLETED' },
  };
  const payoutUpdate = vi.fn().mockResolvedValue({});
  const taskUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const historyCreate = vi.fn().mockResolvedValue({});
  const tx = { payout: { update: payoutUpdate }, task: { updateMany: taskUpdateMany }, taskStatusHistory: { create: historyCreate } };
  const prisma = {
    payout: {
      findUnique: vi.fn().mockResolvedValue(payout),
      updateMany: vi.fn().mockResolvedValue({ count: options.claimCount ?? 1 }),
      update: payoutUpdate,
    },
    payoutAccount: {
      findFirst: vi.fn().mockResolvedValue(
        options.accountTail ? { ...account, accountNumberMasked: `••••••••${options.accountTail}` } : account,
      ),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
  };
  const ledger = { recordPayout: vi.fn().mockResolvedValue(undefined) };
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const publisher = { toTask: vi.fn() };
  const service = new PayoutsService(prisma as never, ledger as never, notifications as never, publisher as never);
  return { service, prisma, ledger, notifications, publisher, payoutUpdate, taskUpdateMany };
}

describe('PayoutsService.process', () => {
  it('sends the payout, writes the ledger, and marks the task paid', async () => {
    const { service, ledger, payoutUpdate, taskUpdateMany, notifications } = build();
    expect(await service.process('po-1')).toEqual({ acted: true });

    expect(payoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }),
    );
    expect(ledger.recordPayout).toHaveBeenCalledWith(
      { taskId: 't1', payoutId: 'po-1', amountPaise: 112_000, kind: 'EARNINGS' },
      expect.anything(),
    );
    expect(taskUpdateMany).toHaveBeenCalledWith({ where: { id: 't1', status: { in: ['COMPLETED'] } }, data: { status: 'PAYMENT_RELEASED' } });
    expect(notifications.notify).toHaveBeenCalledWith('w1', expect.objectContaining({ event: 'PAYMENT_RELEASED' }));
  });

  it('records a declined transfer as FAILED with a reason, and writes no ledger entry', async () => {
    const { service, ledger, payoutUpdate, notifications } = build({ accountTail: '0000' });
    await service.process('po-1');
    expect(payoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', failureReason: expect.any(String) }) }),
    );
    expect(ledger.recordPayout).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith('w1', expect.objectContaining({ event: 'PAYOUT_FAILED' }));
  });

  it('does nothing when another process claimed the payout first', async () => {
    const { service, ledger } = build({ claimCount: 0 });
    expect(await service.process('po-1')).toEqual({ acted: false });
    expect(ledger.recordPayout).not.toHaveBeenCalled();
  });

  it('never re-sends a payout that is already processed', async () => {
    const { service, prisma } = build({ payoutStatus: 'PROCESSED' });
    expect(await service.process('po-1')).toEqual({ acted: false });
    expect(prisma.payout.updateMany).not.toHaveBeenCalled();
  });

  it('keeps payouts owed, untouched, when no payout partner is connected', async () => {
    process.env.PAYOUT_PROVIDER = 'none';
    resetEnvCache();
    const { service, prisma } = build();
    expect(await service.process('po-1')).toEqual({ acted: false });
    expect(prisma.payout.findUnique).not.toHaveBeenCalled();
  });
});
