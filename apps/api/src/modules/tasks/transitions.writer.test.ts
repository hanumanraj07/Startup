import { describe, expect, it, vi } from 'vitest';
import { writeTransition } from './transitions';

/** docs/22, #8: every status write is a compare-and-set against what the caller read. */
function fakeTx(count: number) {
  return {
    task: { updateMany: vi.fn().mockResolvedValue({ count }) },
    taskStatusHistory: { create: vi.fn().mockResolvedValue({}) },
  };
}

describe('writeTransition', () => {
  it('writes the status only where the task still has the status the caller read, plus its own conditions', async () => {
    const tx = fakeTx(1);

    const won = await writeTransition(tx as never, {
      taskId: 't1',
      from: 'PUBLISHED',
      to: 'CANCELLED',
      actorRole: 'REQUESTER',
      actorUserId: 'u1',
      where: { assignedWorkerId: null },
      data: { cancellationReason: 'changed my mind' },
    });

    expect(won).toBe(true);
    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { assignedWorkerId: null, id: 't1', status: { in: ['PUBLISHED'] } },
      data: { cancellationReason: 'changed my mind', status: 'CANCELLED' },
    });
    expect(tx.taskStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ taskId: 't1', fromStatus: 'PUBLISHED', toStatus: 'CANCELLED', actorRole: 'REQUESTER', actorUserId: 'u1' }),
    });
  });

  it('reports a lost race and writes no history', async () => {
    const tx = fakeTx(0);

    const won = await writeTransition(tx as never, { taskId: 't1', from: 'PUBLISHED', to: 'EXPIRED', actorRole: 'SYSTEM' });

    expect(won).toBe(false);
    expect(tx.taskStatusHistory.create).not.toHaveBeenCalled();
  });

  it('can land from a status the caller\'s read was harmlessly overtaken by, without duplicates', async () => {
    const tx = fakeTx(1);

    await writeTransition(tx as never, {
      taskId: 't1',
      from: 'PUBLISHED',
      alsoFrom: ['PUBLISHED', 'MATCHING'],
      to: 'ASSIGNED',
      actorRole: 'WORKER',
    });

    expect(tx.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['PUBLISHED', 'MATCHING'] } }) }),
    );
  });

  it('never lets a caller\'s own where clause widen the status condition', async () => {
    const tx = fakeTx(1);

    await writeTransition(tx as never, {
      taskId: 't1',
      from: 'DISPUTED',
      to: 'COMPLETED',
      actorRole: 'ADMIN',
      where: { status: 'IN_PROGRESS', id: 'someone-else' },
    });

    expect(tx.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['DISPUTED'] }, id: 't1' } }),
    );
  });
});
