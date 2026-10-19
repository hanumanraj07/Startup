import { describe, expect, it, vi } from 'vitest';
import { LedgerService } from './ledger.service';

/** A fake Prisma client narrow enough for the balancing check to exercise without a database. */
function fakePrisma() {
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  return { client: { ledgerEntry: { createMany } } as never, createMany };
}

describe('LedgerService.writeEntries', () => {
  it('writes a balanced group', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);

    await service.writeEntries([
      { account: 'REQUESTER_FUNDS', entryType: 'CAPTURE', amountPaise: -50_000, description: 'a' },
      { account: 'ESCROW', entryType: 'CAPTURE', amountPaise: 50_000, description: 'b' },
    ]);

    expect(createMany).toHaveBeenCalledOnce();
  });

  it('REFUSES an unbalanced group and writes nothing', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);

    await expect(
      service.writeEntries([
        { account: 'REQUESTER_FUNDS', entryType: 'CAPTURE', amountPaise: -50_000, description: 'a' },
        { account: 'ESCROW', entryType: 'CAPTURE', amountPaise: 49_999, description: 'b' },
      ]),
    ).rejects.toThrow(/do not balance/);

    expect(createMany).not.toHaveBeenCalled();
  });

  it('balances a three-way split: commission, GST, and worker payout', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);

    await service.writeEntries([
      { account: 'ESCROW', entryType: 'RELEASE', amountPaise: -100_000, description: 'release' },
      { account: 'PLATFORM_COMMISSION', entryType: 'COMMISSION', amountPaise: 15_000, description: 'fee' },
      { account: 'WORKER_PAYABLE', entryType: 'RELEASE', amountPaise: 85_000, description: 'payout' },
    ]);

    expect(createMany).toHaveBeenCalledOnce();
  });

  it('rejects an empty group only if it is nonzero (an empty array trivially sums to zero)', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);

    await service.writeEntries([]);
    expect(createMany).toHaveBeenCalledWith({ data: [] });
  });

  it('catches a single stray entry with no offsetting counterpart', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);

    await expect(
      service.writeEntries([
        { account: 'ESCROW', entryType: 'CAPTURE', amountPaise: 50_000, description: 'orphaned' },
      ]),
    ).rejects.toThrow(/do not balance/);
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe('LedgerService.recordCapture', () => {
  it('writes exactly the two-line capture entry for the founding example', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);

    await service.recordCapture({ taskId: 't1', paymentId: 'p1', amountPaise: 50_000 });

    const firstCall = createMany.mock.calls[0]?.[0] as { data: { account: string; amountPaise: bigint }[] };
    const written = firstCall.data;
    expect(written).toHaveLength(2);
    expect(written.find((e) => e.account === 'REQUESTER_FUNDS')?.amountPaise).toBe(-50_000n);
    expect(written.find((e) => e.account === 'ESCROW')?.amountPaise).toBe(50_000n);

    const sum = written.reduce((s, e) => s + e.amountPaise, 0n);
    expect(sum).toBe(0n);
  });
});

describe('LedgerService.recordDisputeSplit', () => {
  it('divides escrow between the worker and a refund with no commission, and balances', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);

    await service.recordDisputeSplit({ taskId: 't1', paymentId: 'p1', workerPaise: 30_000, refundPaise: 20_000 });

    const written = (createMany.mock.calls[0]?.[0] as { data: { account: string; amountPaise: bigint }[] }).data;
    expect(written.find((e) => e.account === 'ESCROW')?.amountPaise).toBe(-50_000n);
    expect(written.find((e) => e.account === 'WORKER_PAYABLE')?.amountPaise).toBe(30_000n);
    expect(written.find((e) => e.account === 'REFUND')?.amountPaise).toBe(20_000n);
    expect(written.some((e) => e.account === 'PLATFORM_COMMISSION')).toBe(false);

    const sum = written.reduce((s, e) => s + e.amountPaise, 0n);
    expect(sum).toBe(0n);
  });

  it('omits a zero-amount side entirely rather than writing a no-op entry (e.g. a 100/0 "split")', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);

    await service.recordDisputeSplit({ taskId: 't1', paymentId: 'p1', workerPaise: 50_000, refundPaise: 0 });

    const written = (createMany.mock.calls[0]?.[0] as { data: { account: string; amountPaise: bigint }[] }).data;
    expect(written.some((e) => e.account === 'REFUND')).toBe(false);
    expect(written.reduce((s, e) => s + e.amountPaise, 0n)).toBe(0n);
  });
});

describe('LedgerService.recordRelease — buying an item', () => {
  it('balances commission on the task payment, the reimbursement and the unspent refund', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);

    // ₹200 task payment + ₹1,000 item budget held; the item cost ₹950.
    await service.recordRelease({
      taskId: 't1',
      paymentId: 'p1',
      budgetPaise: 120_000,
      commissionPaise: 3_000,
      gstPaise: 0,
      tcsPaise: 0,
      tdsPaise: 0,
      workerPayoutPaise: 17_000,
      itemReimbursePaise: 95_000,
      itemRefundPaise: 5_000,
    });

    const data = (createMany.mock.calls[0]?.[0] as { data: unknown }).data as { account: string; amountPaise: bigint }[];
    expect(data.reduce((sum, e) => sum + e.amountPaise, 0n)).toBe(0n);
    expect(data.filter((e) => e.account === 'WORKER_PAYABLE').map((e) => e.amountPaise)).toEqual([17_000n, 95_000n]);
    expect(data.find((e) => e.account === 'REFUND')?.amountPaise).toBe(5_000n);
  });

  it('refuses a release whose item figures do not add up to what was held', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);
    await expect(
      service.recordRelease({
        taskId: 't1',
        paymentId: 'p1',
        budgetPaise: 120_000,
        commissionPaise: 3_000,
        gstPaise: 0,
        tcsPaise: 0,
        tdsPaise: 0,
        workerPayoutPaise: 17_000,
        itemReimbursePaise: 95_000,
      }),
    ).rejects.toThrow(/do not balance/);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('records a payout as payable to settled', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);
    await service.recordPayout({ taskId: 't1', payoutId: 'po1', amountPaise: 112_000 });
    const data = (createMany.mock.calls[0]?.[0] as { data: unknown }).data as { account: string; amountPaise: bigint }[];
    expect(data.map((e) => [e.account, e.amountPaise])).toEqual([
      ['WORKER_PAYABLE', -112_000n],
      ['WORKER_SETTLED', 112_000n],
    ]);
  });
});
