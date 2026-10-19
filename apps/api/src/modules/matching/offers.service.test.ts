import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../../config/env';
import { OffersService } from './offers.service';

/**
 * The life of an incoming task request around the atomic accept: closing
 * everyone else's the moment one is taken, expiring unanswered ones, and
 * sending the next wave as soon as a wave is used up.
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
  MATCH_TIER_RADII_M: '3000,7000,15000,30000',
};

beforeEach(() => {
  resetEnvCache();
  process.env = { ...process.env, ...BASE_ENV };
});

function build(overrides: { open?: { id: string; workerId: string; taskId?: string }[]; stillDeciding?: number; task?: object | null } = {}) {
  const taskOffer = {
    findMany: vi.fn().mockResolvedValue((overrides.open ?? []).map((o) => ({ taskId: 't1', ...o }))),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn().mockResolvedValue(overrides.stillDeciding ?? 0),
  };
  const prisma = {
    taskOffer,
    task: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.task === undefined ? { status: 'MATCHING', assignedWorkerId: null, currentRadiusMeters: 3000 } : overrides.task,
      ),
    },
  };
  const queue = { advanceNow: vi.fn().mockResolvedValue(undefined) };
  const publisher = { toUser: vi.fn(), toTask: vi.fn() };
  const service = new OffersService(prisma as never, {} as never, queue as never, publisher as never);
  return { service, taskOffer, queue, publisher };
}

describe('OffersService', () => {
  it('records the winner and tells every other offered worker the task is taken', async () => {
    const { service, taskOffer, publisher } = build({ open: [{ id: 'o2', workerId: 'w2' }, { id: 'o3', workerId: 'w3' }] });
    await service.closeForAssignment('t1', 'w1');

    expect(taskOffer.updateMany).toHaveBeenNthCalledWith(1, {
      where: { taskId: 't1', workerId: 'w1', response: null },
      data: { response: 'ACCEPTED', respondedAt: expect.any(Date) },
    });
    expect(publisher.toUser).toHaveBeenCalledWith('w2', 'offer:closed', { offerId: 'o2', taskId: 't1', reason: 'TAKEN' });
    expect(publisher.toUser).toHaveBeenCalledWith('w3', 'offer:closed', { offerId: 'o3', taskId: 't1', reason: 'TAKEN' });
  });

  it('expires requests past their window and closes them on the worker’s screen', async () => {
    const { service, taskOffer, publisher } = build({ open: [{ id: 'o1', workerId: 'w1' }] });
    await expect(service.expireOverdue()).resolves.toBe(1);
    expect(taskOffer.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['o1'] }, response: null },
      data: { response: 'EXPIRED' },
    });
    expect(publisher.toUser).toHaveBeenCalledWith('w1', 'offer:closed', { offerId: 'o1', taskId: 't1', reason: 'EXPIRED' });
  });

  it('sends the next wave at once when nobody in the current one is still deciding', async () => {
    const { service, queue } = build({ stillDeciding: 0 });
    await service.advanceIfWaveDone('t1');
    // Current radius 3 km is tier 0, so tier 1 (7 km) goes now.
    expect(queue.advanceNow).toHaveBeenCalledWith('t1', 1);
  });

  it('waits while someone in the wave is still deciding, and never advances past the last tier or an assigned task', async () => {
    const deciding = build({ stillDeciding: 2 });
    await deciding.service.advanceIfWaveDone('t1');
    expect(deciding.queue.advanceNow).not.toHaveBeenCalled();

    const lastTier = build({ task: { status: 'MATCHING', assignedWorkerId: null, currentRadiusMeters: 30000 } });
    await lastTier.service.advanceIfWaveDone('t1');
    expect(lastTier.queue.advanceNow).not.toHaveBeenCalled();

    const assigned = build({ task: { status: 'ASSIGNED', assignedWorkerId: 'w1', currentRadiusMeters: 3000 } });
    await assigned.service.advanceIfWaveDone('t1');
    expect(assigned.queue.advanceNow).not.toHaveBeenCalled();
  });
});
