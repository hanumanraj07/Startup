import { describe, expect, it, vi } from 'vitest';
import { SweeperService } from './sweeper.service';

function build(rows: { id: string; status: string }[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const review = { releaseStranded: vi.fn().mockResolvedValue({ acted: true }) };
  const tasks = { refundStranded: vi.fn().mockResolvedValue({ acted: true }) };
  const sweeper = new SweeperService(
    { task: { findMany } } as never,
    review as never,
    tasks as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { sweeper, findMany, review, tasks };
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

  it('keeps going when one repair fails', async () => {
    const { sweeper, tasks } = build([
      { id: 'a', status: 'EXPIRED' },
      { id: 'b', status: 'EXPIRED' },
    ]);
    tasks.refundStranded.mockRejectedValueOnce(new Error('db down'));

    expect(await sweeper.runStrandedMoneySweep()).toEqual({ processed: 2, acted: 1 });
  });
});
