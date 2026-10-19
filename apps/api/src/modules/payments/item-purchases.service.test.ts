import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../../config/env';
import { ItemPurchasesService } from './item-purchases.service';

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
});

const WORKER = 'w1';
const KEY = 'tasks/t1/proofs/w1/bill.jpg';

function build(opts: {
  level?: number;
  ownVpa?: boolean;
  canPayShops?: boolean;
  task?: Record<string, unknown>;
  approved?: Record<string, unknown> | null;
} = {}) {
  const task = {
    id: 't1',
    title: 'Bring butter',
    status: 'IN_PROGRESS',
    requesterId: 'r1',
    assignedWorkerId: WORKER,
    itemBudgetPaise: 100_000n,
    itemTopUpPaise: 0n,
    handoverCode: '0427',
    handoverAttempts: 0,
    handoverConfirmedAt: null,
    ...opts.task,
  };
  const created = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'b1',
    status: 'PENDING_APPROVAL',
    expiresAt: new Date(Date.now() + 600_000),
    decidedAt: null,
    rejectReason: null,
    topUpCapturedAt: null,
    shopPaymentStatus: null,
    shopPaymentReference: null,
    shopPaymentFailureReason: null,
    spentRecordedAt: null,
    createdAt: new Date(),
    ...data,
    amountPaise: BigInt(data.amountPaise as number),
    topUpPaise: BigInt(data.topUpPaise as number),
  }));
  const tx = {
    itemPurchase: { create: created, updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    task: { findUnique: vi.fn().mockResolvedValue(task), update: vi.fn().mockResolvedValue({}) },
    itemPurchase: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(opts.approved ?? null),
      findUniqueOrThrow: vi.fn().mockResolvedValue(opts.approved ?? null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ verificationLevel: opts.level ?? 2 }) },
    payoutAccount: { findFirst: vi.fn().mockResolvedValue(opts.ownVpa ? { id: 'pa1' } : null) },
    $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ ...tx, itemPurchase: { ...tx.itemPurchase, ...prismaPurchaseTx } })),
  };
  const prismaPurchaseTx = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
  const ledger = { recordItemSpend: vi.fn().mockResolvedValue(undefined) };
  const payouts = {
    canPayShops: vi.fn().mockReturnValue(opts.canPayShops ?? true),
    recordReimbursement: vi.fn().mockResolvedValue({}),
    sendOwed: vi.fn().mockResolvedValue(undefined),
  };
  const storage = { headObject: vi.fn().mockResolvedValue({ exists: true }), presignGet: vi.fn() };
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const publisher = { toTask: vi.fn() };
  const service = new ItemPurchasesService(
    prisma as never,
    ledger as never,
    {} as never,
    payouts as never,
    storage as never,
    notifications as never,
    publisher as never,
  );
  return { service, prisma, ledger, payouts, notifications, created, task };
}

const bill = { amountPaise: 95_000, description: 'Two packs of butter', billStorageKey: KEY };

describe('ItemPurchasesService.create', () => {
  it('sends a bill for approval, paying nothing, and tells the requester', async () => {
    const { service, created, notifications } = build();
    const view = await service.create('t1', WORKER, { ...bill, method: 'SHOP_UPI', merchantVpa: 'kirana@okaxis' });
    expect(view.status).toBe('PENDING_APPROVAL');
    expect(view.topUpPaise).toBe(0);
    expect(created).toHaveBeenCalledOnce();
    expect(notifications.notify).toHaveBeenCalledWith('r1', expect.objectContaining({ event: 'ITEM_BILL_SENT', amountPaise: 95_000 }));
  });

  it('works out the top-up for a bill above what is left of the budget', async () => {
    const { service } = build();
    const view = await service.create('t1', WORKER, { ...bill, amountPaise: 125_000, method: 'SHOP_UPI', merchantVpa: 'kirana@okaxis' });
    expect(view.topUpPaise).toBe(25_000);
  });

  it('refuses cash above the worker’s level cap', async () => {
    const { service } = build({ level: 2 });
    await expect(service.create('t1', WORKER, { ...bill, amountPaise: 250_000, method: 'WORKER_CASH' })).rejects.toThrow(
      /at most ₹2,000 in cash/,
    );
  });

  it('refuses the worker’s own UPI ID as the shop', async () => {
    const { service } = build({ ownVpa: true });
    await expect(service.create('t1', WORKER, { ...bill, method: 'SHOP_UPI', merchantVpa: 'me@okaxis' })).rejects.toThrow(
      /your own UPI ID/,
    );
  });

  it('refuses a bill photo uploaded for another task or worker', async () => {
    const { service } = build();
    await expect(
      service.create('t1', WORKER, { ...bill, billStorageKey: 'tasks/t2/proofs/w1/x.jpg', method: 'WORKER_CASH' }),
    ).rejects.toThrow(/Upload the bill photo again/);
  });

  it('refuses before the worker is at the pickup', async () => {
    const { service } = build({ task: { status: 'WORKER_EN_ROUTE' } });
    await expect(service.create('t1', WORKER, { ...bill, method: 'WORKER_CASH' })).rejects.toThrow(/at the pickup/);
  });
});

describe('ItemPurchasesService.confirmHandover', () => {
  const cash = { id: 'b1', taskId: 't1', workerId: WORKER, status: 'APPROVED', method: 'WORKER_CASH', amountPaise: 95_000n };

  it('needs no code when no bill was approved', async () => {
    const { service, task } = build();
    await expect(service.confirmHandover(task as never, WORKER, undefined)).resolves.toBeUndefined();
  });

  it('counts a wrong code and says how many tries are left', async () => {
    const { service, prisma, task } = build({ approved: cash });
    await expect(service.confirmHandover(task as never, WORKER, '1111')).rejects.toThrow(/4 tries left/);
    expect(prisma.task.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { handoverAttempts: { increment: 1 } } });
  });

  it('locks after five wrong codes', async () => {
    const { service, task } = build({ approved: cash, task: { handoverAttempts: 5 } });
    await expect(service.confirmHandover(task as never, WORKER, '0427')).rejects.toThrow(/Report an issue/);
  });

  it('repays a cash bill as soon as the right code is entered, apart from earnings', async () => {
    const { service, ledger, payouts, task } = build({ approved: cash });
    await service.confirmHandover(task as never, WORKER, '0427');
    expect(ledger.recordItemSpend).toHaveBeenCalledWith({ taskId: 't1', amountPaise: 95_000, route: 'CASH' }, expect.anything());
    expect(payouts.recordReimbursement).toHaveBeenCalledWith({ taskId: 't1', workerId: WORKER, purchaseId: 'b1', amountPaise: 95_000 });
    expect(payouts.sendOwed).toHaveBeenCalledWith(WORKER);
  });

  it('will not hand over a UPI bill the shop has not been paid for', async () => {
    const { service, task } = build({ approved: { ...cash, method: 'SHOP_UPI', shopPaymentStatus: 'FAILED' } });
    await expect(service.confirmHandover(task as never, WORKER, '0427')).rejects.toThrow(/has not gone through/);
  });
});
