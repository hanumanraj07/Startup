import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchingService } from './matching.service';
import type { NearbyWorker } from '../../repositories/geo.repository';
import { resetEnvCache } from '../../config/env';

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

/**
 * A fake Prisma narrow enough to exercise MatchingService without a database,
 * following the same pattern as ledger.service.test.ts. `$transaction` here
 * just resolves whatever array of promises it is given, which is enough to
 * observe which writes were attempted.
 */
function fakePrisma(task: Record<string, unknown> | null) {
  const taskUpdate = vi.fn().mockResolvedValue({});
  const historyCreate = vi.fn().mockResolvedValue({});
  const taskOfferCreateMany = vi.fn().mockResolvedValue({ count: 0 });
  const workerProfileUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
  const aggregate = vi.fn().mockResolvedValue({ _avg: { ratingAvg: null, completionRate: null, responseRate: null } });

  const client = {
    task: { findUnique: vi.fn().mockResolvedValue(task), update: taskUpdate },
    taskStatusHistory: { create: historyCreate },
    taskOffer: { findMany: vi.fn().mockResolvedValue([]), createMany: taskOfferCreateMany },
    workerProfile: { updateMany: workerProfileUpdateMany, aggregate },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return { client, taskUpdate, historyCreate, taskOfferCreateMany, workerProfileUpdateMany, aggregate };
}

function fakeGeo(candidates: NearbyWorker[]) {
  return { findNearbyWorkers: vi.fn().mockResolvedValue(candidates) };
}

function fakeNotifications() {
  return { notify: vi.fn().mockResolvedValue(undefined) };
}

function fakeSafety() {
  return { getBlockedUserIds: vi.fn().mockResolvedValue([]), isBlocked: vi.fn().mockResolvedValue(false) };
}

function fakeQueue() {
  return { scheduleTier: vi.fn().mockResolvedValue(undefined), cancelPending: vi.fn().mockResolvedValue(undefined) };
}

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    requesterId: 'req1',
    assignedWorkerId: null,
    status: 'PUBLISHED',
    taskLat: 23.02,
    taskLng: 72.57,
    categoryId: 'cat1',
    minVerificationLevel: 1,
    deadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

function candidate(overrides: Partial<NearbyWorker> = {}): NearbyWorker {
  return {
    userId: 'w1',
    workerProfileId: 'wp1',
    distanceMeters: 500,
    ratingAvg: 4.8,
    ratingCount: 10,
    tasksCompleted: 20,
    completionRate: 90,
    responseRate: 80,
    verificationLevel: 2,
    lastActiveAt: new Date(),
    categoryTasksCompleted: 5,
    ...overrides,
  };
}

describe('MatchingService.runTierPass', () => {
  it('is a no-op when the task does not exist', async () => {
    const { client } = fakePrisma(null);
    const service = new MatchingService(client as never, fakeGeo([]) as never, fakeQueue() as never, fakeNotifications() as never, fakeSafety() as never);
    const result = await service.runTierPass('missing', 0);
    expect(result).toEqual({ acted: false, offered: 0 });
  });

  it('is a no-op once a worker is already assigned', async () => {
    const { client } = fakePrisma(baseTask({ assignedWorkerId: 'w9', status: 'ASSIGNED' }));
    const service = new MatchingService(client as never, fakeGeo([]) as never, fakeQueue() as never, fakeNotifications() as never, fakeSafety() as never);
    const result = await service.runTierPass('t1', 0);
    expect(result).toEqual({ acted: false, offered: 0 });
  });

  it('is a no-op once the task has left PUBLISHED/MATCHING (cancelled, expired, etc.)', async () => {
    const { client } = fakePrisma(baseTask({ status: 'CANCELLED' }));
    const service = new MatchingService(client as never, fakeGeo([]) as never, fakeQueue() as never, fakeNotifications() as never, fakeSafety() as never);
    const result = await service.runTierPass('t1', 0);
    expect(result).toEqual({ acted: false, offered: 0 });
  });

  it('transitions PUBLISHED to MATCHING on the first tier pass', async () => {
    const { client, historyCreate } = fakePrisma(baseTask({ status: 'PUBLISHED' }));
    const service = new MatchingService(
      client as never,
      fakeGeo([candidate()]) as never,
      fakeQueue() as never,
      fakeNotifications() as never,
      fakeSafety() as never,
    );
    await service.runTierPass('t1', 0);
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromStatus: 'PUBLISHED', toStatus: 'MATCHING' }) }),
    );
  });

  it('does not re-transition a task already in MATCHING on a later tier pass', async () => {
    const { client, historyCreate } = fakePrisma(baseTask({ status: 'MATCHING' }));
    const service = new MatchingService(
      client as never,
      fakeGeo([candidate()]) as never,
      fakeQueue() as never,
      fakeNotifications() as never,
      fakeSafety() as never,
    );
    await service.runTierPass('t1', 1);
    expect(historyCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStatus: 'MATCHING' }) }),
    );
  });

  it('jumps straight to the final tier when nobody at all is eligible at the current tier', async () => {
    const { client } = fakePrisma(baseTask());
    const queue = fakeQueue();
    const service = new MatchingService(client as never, fakeGeo([]) as never, queue as never, fakeNotifications() as never, fakeSafety() as never);
    const result = await service.runTierPass('t1', 0);
    expect(result.offered).toBe(0);
    expect(queue.scheduleTier).toHaveBeenCalledWith('t1', 3, 0);
  });

  it('schedules nothing further when even the final tier has nobody eligible', async () => {
    const { client } = fakePrisma(baseTask());
    const queue = fakeQueue();
    const service = new MatchingService(client as never, fakeGeo([]) as never, queue as never, fakeNotifications() as never, fakeSafety() as never);
    await service.runTierPass('t1', 3);
    expect(queue.scheduleTier).not.toHaveBeenCalled();
  });

  it('offers the eligible candidates and schedules the next tier when one exists', async () => {
    const { client, taskOfferCreateMany } = fakePrisma(baseTask());
    const queue = fakeQueue();
    const service = new MatchingService(
      client as never,
      fakeGeo([candidate({ userId: 'w1' }), candidate({ userId: 'w2', distanceMeters: 1200 })]) as never,
      queue as never,
      fakeNotifications() as never,
      fakeSafety() as never,
    );

    const result = await service.runTierPass('t1', 0);

    expect(result.offered).toBe(2);
    expect(taskOfferCreateMany).toHaveBeenCalledOnce();
    const callArgs = taskOfferCreateMany.mock.calls[0];
    if (!callArgs) throw new Error('taskOfferCreateMany was not called');
    const { data } = callArgs[0] as { data: Array<{ workerId: string; rank: number }> };
    const first = data[0];
    if (!first) throw new Error('no offers were created');
    // Closer candidate (w1) should rank ahead of the farther one, all else equal.
    expect(first.workerId).toBe('w1');
    expect(first.rank).toBe(1);
    expect(queue.scheduleTier).toHaveBeenCalledWith('t1', 1, expect.any(Number));
  });

  it('does not schedule a next tier once already at the final tier', async () => {
    const { client } = fakePrisma(baseTask());
    const queue = fakeQueue();
    const service = new MatchingService(client as never, fakeGeo([candidate()]) as never, queue as never, fakeNotifications() as never, fakeSafety() as never);
    await service.runTierPass('t1', 3);
    expect(queue.scheduleTier).not.toHaveBeenCalled();
  });
});
