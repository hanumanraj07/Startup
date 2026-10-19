import { describe, expect, it, vi } from 'vitest';
import { TasksService } from './tasks.service';
import { RiskService } from './risk.service';
import { BusinessRuleError, ConflictError, IllegalTransitionError, NotFoundError } from '../../common/errors';

/**
 * Leaving and removing: the assignment is released, the task goes back to
 * matching, and nothing about the requester's held money changes. What this
 * pins down is everything that has to happen together — and the cases that
 * must be refused.
 */

const REQUESTER = 'req-1';
const WORKER = 'wkr-1';

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    title: 'Inspect a laptop',
    requesterId: REQUESTER,
    assignedWorkerId: WORKER,
    status: 'ASSIGNED',
    ...overrides,
  };
}

function build(current: Record<string, unknown>, opts: { removals?: number; updateCount?: number } = {}) {
  const profile = { userId: WORKER, tasksAccepted: 4, tasksCompleted: 3, tasksAbandoned: 0 };
  const tx = {
    task: { updateMany: vi.fn().mockResolvedValue({ count: opts.updateCount ?? 1 }) },
    taskRelease: { create: vi.fn().mockResolvedValue({}) },
    taskStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    taskProof: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    workerProfile: { findUnique: vi.fn().mockResolvedValue(profile), update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    task: { findUnique: vi.fn().mockResolvedValue(current) },
    taskRelease: { count: vi.fn().mockResolvedValue(opts.removals ?? 0) },
    user: { findUnique: vi.fn().mockResolvedValue({ displayName: 'Rahul S.' }) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const realtime = { emitTaskStatus: vi.fn(), removeUserFromTask: vi.fn().mockResolvedValue(undefined) };
  const queue = { scheduleTier: vi.fn().mockResolvedValue(undefined) };
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const live = { end: vi.fn().mockResolvedValue(undefined) };
  const service = new TasksService(
    prisma as never,
    {} as never,
    new RiskService(),
    {} as never,
    queue as never,
    notifications as never,
    {} as never,
    realtime as never,
    {} as never,
    {} as never,
    {} as never,
    live as never,
  );
  // removeWorker returns the requester's projection; that read is not under test.
  vi.spyOn(service, 'getById').mockResolvedValue({} as never);
  return { service, tx, realtime, queue, notifications };
}

describe('TasksService.leave', () => {
  it('releases the assignment, discards the worker\'s proof, penalises completion and re-matches', async () => {
    const { service, tx, realtime, queue, notifications } = build(task({ status: 'IN_PROGRESS' }));

    await expect(service.leave('t1', WORKER, { reason: 'PERSONAL_EMERGENCY' })).resolves.toEqual({ status: 'MATCHING' });

    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', status: 'IN_PROGRESS', assignedWorkerId: WORKER },
      data: { status: 'MATCHING', assignedWorkerId: null, assignedAt: null },
    });
    expect(tx.taskRelease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ taskId: 't1', workerId: WORKER, initiatedBy: 'WORKER', fromStatus: 'IN_PROGRESS' }),
    });
    expect(tx.taskProof.deleteMany).toHaveBeenCalledWith({ where: { taskId: 't1', workerId: WORKER } });
    // 3 of 4 accepted completed → 75%, and one more abandonment on record.
    expect(tx.workerProfile.update).toHaveBeenCalledWith({
      where: { userId: WORKER },
      data: { tasksAccepted: 4, tasksAbandoned: 1, completionRate: 75 },
    });
    expect(realtime.removeUserFromTask).toHaveBeenCalledWith('t1', WORKER);
    expect(queue.scheduleTier).toHaveBeenCalledWith('t1', 0, 0);
    expect(notifications.notify).toHaveBeenCalledWith(REQUESTER, expect.objectContaining({ event: 'WORKER_LEFT' }));
  });

  it('refuses anyone who is not the assigned worker', async () => {
    const { service } = build(task());
    await expect(service.leave('t1', 'someone-else', { reason: 'OTHER', note: 'just because' })).rejects.toThrow(NotFoundError);
  });

  it('refuses once the proof has been submitted', async () => {
    const { service } = build(task({ status: 'SUBMITTED' }));
    await expect(service.leave('t1', WORKER, { reason: 'PERSONAL_EMERGENCY' })).rejects.toThrow(IllegalTransitionError);
  });

  it('loses cleanly to a concurrent change instead of double-releasing', async () => {
    const { service, tx } = build(task(), { updateCount: 0 });
    await expect(service.leave('t1', WORKER, { reason: 'PERSONAL_EMERGENCY' })).rejects.toThrow(ConflictError);
    expect(tx.taskRelease.create).not.toHaveBeenCalled();
  });
});

describe('TasksService.removeWorker', () => {
  it('releases a worker who has not arrived yet, without counting it against them', async () => {
    const { service, tx, notifications } = build(task({ status: 'WORKER_EN_ROUTE' }));

    await service.removeWorker('t1', REQUESTER, { reason: 'NOT_RESPONDING' });

    expect(tx.taskRelease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ initiatedBy: 'REQUESTER', fromStatus: 'WORKER_EN_ROUTE' }),
    });
    // The undone acceptance is taken back out: 3 of 3 → 100%, no abandonment.
    expect(tx.workerProfile.update).toHaveBeenCalledWith({
      where: { userId: WORKER },
      data: { tasksAccepted: 3, tasksAbandoned: 0, completionRate: 100 },
    });
    expect(notifications.notify).toHaveBeenCalledWith(WORKER, expect.objectContaining({ event: 'WORKER_REMOVED' }));
  });

  it('refuses once the worker has arrived', async () => {
    for (const status of ['ARRIVED', 'IN_PROGRESS', 'SUBMITTED']) {
      const { service, tx } = build(task({ status }));
      await expect(service.removeWorker('t1', REQUESTER, { reason: 'TOO_SLOW' }), status).rejects.toThrow(BusinessRuleError);
      expect(tx.task.updateMany).not.toHaveBeenCalled();
    }
  });

  it('refuses someone who does not own the task', async () => {
    const { service } = build(task());
    await expect(service.removeWorker('t1', 'not-the-owner', { reason: 'TOO_SLOW' })).rejects.toThrow(NotFoundError);
  });

  it('stops after three removals on the same task', async () => {
    const { service, tx } = build(task(), { removals: 3 });
    await expect(service.removeWorker('t1', REQUESTER, { reason: 'TOO_SLOW' })).rejects.toThrow(/already removed 3 workers/);
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });
});
