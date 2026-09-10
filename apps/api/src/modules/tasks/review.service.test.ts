import { describe, expect, it, vi } from 'vitest';
import { ReviewService } from './review.service';
import { ConflictError } from '../../common/errors';

/**
 * A fake Prisma narrow enough to exercise the dispute-vs-approval race
 * without a database, following ledger.service.test.ts's pattern.
 * `task.updateMany`'s return count is the whole point: it is what actually
 * decides the race described in review.service.ts's own comment, so every
 * test here drives it directly rather than trying to simulate real
 * concurrency.
 */
function fakePrisma(task: Record<string, unknown> | null, updateManyCount: number) {
  const updateMany = vi.fn().mockResolvedValue({ count: updateManyCount });
  const historyCreate = vi.fn().mockResolvedValue({});
  const workerProfileFindUnique = vi.fn().mockResolvedValue(null);

  const client = {
    task: { findUnique: vi.fn().mockResolvedValue(task), updateMany },
    taskStatusHistory: { create: historyCreate },
    workerProfile: { findUnique: workerProfileFindUnique, update: vi.fn() },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return { client, updateMany, historyCreate };
}

function fakePayments() {
  return { release: vi.fn().mockResolvedValue(undefined) };
}

function fakeAutoApproveQueue() {
  return { schedule: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined) };
}

function fakeNotifications() {
  return { notify: vi.fn().mockResolvedValue(undefined) };
}

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    requesterId: 'req1',
    assignedWorkerId: 'worker1',
    status: 'SUBMITTED',
    title: 'A task',
    commissionPaise: 7_500n,
    gstPaise: 0n,
    tcsPaise: 0n,
    tdsPaise: 0n,
    workerPayoutPaise: 42_500n,
    ...overrides,
  };
}

describe('ReviewService.autoApprove — the dispute-vs-approval race', () => {
  it('completes normally when the atomic update wins the race (count 1)', async () => {
    const { client, updateMany } = fakePrisma(baseTask(), 1);
    const payments = fakePayments();
    const service = new ReviewService(client as never, payments as never, fakeAutoApproveQueue() as never, fakeNotifications() as never);

    const result = await service.autoApprove('t1');

    expect(result.acted).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }) }),
    );
    expect(payments.release).toHaveBeenCalledOnce();
  });

  it('does NOT release payment when a dispute wins the race (updateMany affects zero rows)', async () => {
    const { client } = fakePrisma(baseTask(), 0);
    const payments = fakePayments();
    const service = new ReviewService(client as never, payments as never, fakeAutoApproveQueue() as never, fakeNotifications() as never);

    const result = await service.autoApprove('t1');

    expect(result.acted).toBe(false);
    expect(payments.release).not.toHaveBeenCalled();
  });

  it('is a no-op when the task is not in SUBMITTED/UNDER_REVIEW at all (e.g. already DISPUTED)', async () => {
    const { client } = fakePrisma(baseTask({ status: 'DISPUTED' }), 1);
    const payments = fakePayments();
    const service = new ReviewService(client as never, payments as never, fakeAutoApproveQueue() as never, fakeNotifications() as never);

    const result = await service.autoApprove('t1');

    expect(result.acted).toBe(false);
    expect(payments.release).not.toHaveBeenCalled();
  });
});

describe('ReviewService.approve', () => {
  it('returns COMPLETED when it wins the race', async () => {
    const { client } = fakePrisma(baseTask(), 1);
    const service = new ReviewService(client as never, fakePayments() as never, fakeAutoApproveQueue() as never, fakeNotifications() as never);

    const result = await service.approve('t1', 'req1');
    expect(result).toEqual({ status: 'COMPLETED' });
  });

  it('throws ConflictError rather than releasing payment when a dispute won the race first', async () => {
    const { client } = fakePrisma(baseTask(), 0);
    const payments = fakePayments();
    const service = new ReviewService(client as never, payments as never, fakeAutoApproveQueue() as never, fakeNotifications() as never);

    await expect(service.approve('t1', 'req1')).rejects.toThrow(ConflictError);
    expect(payments.release).not.toHaveBeenCalled();
  });
});

describe('ReviewService.reject', () => {
  it('throws ConflictError when a dispute already changed the task status', async () => {
    const { client } = fakePrisma(baseTask(), 0);
    const service = new ReviewService(client as never, fakePayments() as never, fakeAutoApproveQueue() as never, fakeNotifications() as never);

    await expect(service.reject('t1', 'req1', 'Not good enough')).rejects.toThrow(ConflictError);
  });

  it('succeeds and cancels the auto-approve queue job when it wins the race', async () => {
    const { client } = fakePrisma(baseTask(), 1);
    const autoApproveQueue = fakeAutoApproveQueue();
    const service = new ReviewService(client as never, fakePayments() as never, autoApproveQueue as never, fakeNotifications() as never);

    const result = await service.reject('t1', 'req1', 'Not good enough');
    expect(result).toEqual({ status: 'IN_PROGRESS' });
    expect(autoApproveQueue.cancel).toHaveBeenCalledWith('t1');
  });
});
