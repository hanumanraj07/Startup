import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TasksService } from './tasks.service';
import { RiskService } from './risk.service';
import { BusinessRuleError } from '../../common/errors';
import { resetEnvCache } from '../../config/env';

/**
 * docs/22, #3: a requester paid ₹100 for a draft, raised its price to
 * ₹50,000, and published, because publish only asked whether *some* payment
 * was captured. The price is now frozen once payment starts, and publish
 * requires the captured amount to equal what the task owes.
 */

const REQUESTER_ID = 'req-1';

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
  process.env = { ...process.env, ...BASE_ENV };
});

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    requesterId: REQUESTER_ID,
    status: 'DRAFT',
    title: 'Check a shop',
    description: 'Photos of the shop front',
    customCategoryLabel: null,
    riskLevel: 'LOW',
    deadlineAt: new Date(Date.now() + 3_600_000),
    budgetPaise: 5_000_000n,
    itemBudgetPaise: 0n,
    ...overrides,
  };
}

function build(task: ReturnType<typeof draft>, payment: { status: string; amountPaise: bigint } | null) {
  const taskUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    task: { findUnique: vi.fn().mockResolvedValue(task), update: taskUpdate, updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    taskStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  const payments = { forTask: vi.fn().mockResolvedValue(payment) };
  const moderation = { screenTask: vi.fn().mockResolvedValue(undefined), assertNotRestricted: vi.fn().mockResolvedValue(undefined) };
  const matchingQueue = { scheduleTier: vi.fn().mockResolvedValue(undefined) };
  const publisher = { taskStatus: vi.fn() };

  const service = new TasksService(
    prisma as never,
    {} as never,
    new RiskService(),
    payments as never,
    matchingQueue as never,
    {} as never,
    {} as never,
    moderation as never,
    {} as never,
    publisher as never,
    {} as never,
  );
  vi.spyOn(service, 'getById').mockResolvedValue({} as never);
  return { service, taskUpdate, matchingQueue };
}

describe('TasksService.update — the price is frozen once payment starts', () => {
  it('refuses a new budget when a payment exists', async () => {
    const { service, taskUpdate } = build(draft({ budgetPaise: 10_000n }), { status: 'CAPTURED', amountPaise: 10_000n });

    await expect(service.update('t1', REQUESTER_ID, { budgetPaise: 5_000_000 } as never)).rejects.toThrow(BusinessRuleError);
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it('refuses a new item budget or category even while the gateway order is still unpaid', async () => {
    const { service } = build(draft(), { status: 'CREATED', amountPaise: 5_000_000n });

    await expect(service.update('t1', REQUESTER_ID, { itemBudgetPaise: 500_000 } as never)).rejects.toThrow(BusinessRuleError);
    await expect(service.update('t1', REQUESTER_ID, { categorySlug: 'pickup-delivery' } as never)).rejects.toThrow(BusinessRuleError);
  });
});

describe('TasksService.publish — what was captured must be what the task owes', () => {
  it('refuses when the captured amount is less than the price', async () => {
    const { service, matchingQueue } = build(draft(), { status: 'CAPTURED', amountPaise: 10_000n });

    await expect(service.publish('t1', REQUESTER_ID)).rejects.toThrow(/does not match its price/);
    expect(matchingQueue.scheduleTier).not.toHaveBeenCalled();
  });

  it('counts the item budget in what is owed', async () => {
    const { service } = build(draft({ itemBudgetPaise: 200_000n }), { status: 'CAPTURED', amountPaise: 5_000_000n });

    await expect(service.publish('t1', REQUESTER_ID)).rejects.toThrow(/does not match its price/);
  });

  it('publishes when the captured amount matches', async () => {
    const { service, matchingQueue } = build(draft({ itemBudgetPaise: 200_000n }), { status: 'CAPTURED', amountPaise: 5_200_000n });

    await service.publish('t1', REQUESTER_ID);
    expect(matchingQueue.scheduleTier).toHaveBeenCalledWith('t1', 0, 0);
  });
});
