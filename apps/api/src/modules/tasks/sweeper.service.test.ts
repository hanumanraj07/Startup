import { describe, expect, it, vi } from 'vitest';
import { SweeperService } from './sweeper.service';

function build(rows: { id: string; status: string; disputes?: { id: string }[] }[]) {
  rows = rows.map((r) => ({ disputes: [], ...r }));
  const findMany = vi.fn().mockResolvedValue(rows);
  const review = { releaseStranded: vi.fn().mockResolvedValue({ acted: true }) };
  const tasks = { refundStranded: vi.fn().mockResolvedValue({ acted: true }) };
  const disputes = { settleResolution: vi.fn().mockResolvedValue({ acted: true }) };
  const sweeper = new SweeperService(
    { task: { findMany } } as never,
    review as never,
    tasks as never,
    {} as never,
    {} as never,
    {} as never,
    disputes as never,
    {} as never,
    {} as never,
  );
  return { sweeper, findMany, review, tasks, disputes };
}

describe('SweeperService.runStrandedMoneySweep (docs/22, #1 and #2)', () => {
  it('refunds EXPIRED and CANCELLED tasks and releases COMPLETED ones', async () => {
    const { sweeper, review, tasks } = build([
      { id: 'a', status: 'EXPIRED' },
      { id: 'b', status: 'COMPLETED' },
      { id: 'c', status: 'CANCELLED' },
    ]);

    const result = await sweeper.runStrandedMoneySweep();

    expect(result).toEqual({ processed: 3, acted: 3 });
    expect(tasks.refundStranded.mock.calls.map((c) => c[0])).toEqual(['a', 'c']);
    expect(review.releaseStranded).toHaveBeenCalledWith('b');
  });

  it('only reads finished tasks whose payment is still captured and that have sat for a while', async () => {
    const { sweeper, findMany } = build([]);
    await sweeper.runStrandedMoneySweep();

    const where = findMany.mock.calls[0]?.[0].where;
    expect(where.status).toEqual({ in: ['EXPIRED', 'CANCELLED', 'COMPLETED'] });
    expect(where.payment).toEqual({ status: 'CAPTURED' });
    expect(where.updatedAt.lte.getTime()).toBeLessThan(Date.now() - 60_000);
  });

  it('finishes a dispute decision the way the admin decided, not with a plain release or refund', async () => {
    const { sweeper, review, tasks, disputes } = build([
      { id: 'a', status: 'COMPLETED', disputes: [{ id: 'd1' }] },
      { id: 'b', status: 'CANCELLED', disputes: [{ id: 'd2' }] },
    ]);

    await sweeper.runStrandedMoneySweep();

    expect(disputes.settleResolution.mock.calls.map((c) => c[0])).toEqual(['d1', 'd2']);
    expect(review.releaseStranded).not.toHaveBeenCalled();
    expect(tasks.refundStranded).not.toHaveBeenCalled();
  });

  it('keeps going when one repair fails', async () => {
    const { sweeper, tasks } = build([
      { id: 'a', status: 'EXPIRED' },
      { id: 'b', status: 'EXPIRED' },
    ]);
    tasks.refundStranded.mockRejectedValueOnce(new Error('db down'));

    expect(await sweeper.runStrandedMoneySweep()).toEqual({ processed: 2, acted: 1 });
  });
});

describe('SweeperService.exclusive (docs/22, #19)', () => {
  it('skips a sweep whose previous pass is still running, and runs it again once that pass ends', async () => {
    const { sweeper } = build([]);
    let finish: () => void = () => undefined;
    const slow = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));

    const first = sweeper.exclusive('refunds', slow);
    expect(await sweeper.exclusive('refunds', slow)).toBe(false);
    expect(slow).toHaveBeenCalledOnce();

    finish();
    expect(await first).toBe(true);
    const third = sweeper.exclusive('refunds', async () => undefined);
    expect(await third).toBe(true);
  });

  it('a failing sweep does not stay marked as running', async () => {
    const { sweeper } = build([]);
    await sweeper.exclusive('payouts', () => Promise.reject(new Error('db down')));
    expect(await sweeper.exclusive('payouts', async () => undefined)).toBe(true);
  });
});
