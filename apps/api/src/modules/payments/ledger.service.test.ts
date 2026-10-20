import { describe, expect, it, vi } from 'vitest';
import { LedgerService } from './ledger.service';

/**
 * A fake Prisma client narrow enough for the balancing check to exercise
 * without a database. A refund credit also queues a gateway refund, so the
 * task's payment, its top-ups and its earlier refunds are faked too.
 */
function fakePrisma(
  options: {
    payment?: { id: string; gateway: string; gatewayPaymentId: string | null; amountPaise: bigint } | null;
    topUps?: { id: string; topUpGateway: string | null; topUpGatewayPaymentId: string | null; topUpPaise: bigint }[];
    earlierRefunds?: { paymentId: string | null; itemPurchaseId: string | null; amountPaise: bigint }[];
    /** What escrow holds once the entries are written. */
    escrowAfterPaise?: bigint;
  } = {},
) {
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  const refundCreateMany = vi.fn().mockResolvedValue({ count: 0 });
  const client: Record<string, unknown> = {
    ledgerEntry: {
      createMany,
      aggregate: vi.fn().mockResolvedValue({ _sum: { amountPaise: options.escrowAfterPaise ?? 1_000_000n } }),
    },
    payment: {
      findUnique: vi.fn().mockResolvedValue(
        options.payment === undefined ? { id: 'p1', gateway: 'RAZORPAY', gatewayPaymentId: 'pay_1', amountPaise: 1_000_000n } : options.payment,
      ),
    },
    itemPurchase: { findMany: vi.fn().mockResolvedValue(options.topUps ?? []) },
    refund: { findMany: vi.fn().mockResolvedValue(options.earlierRefunds ?? []), createMany: refundCreateMany },
  };
  client.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client));
  return { client: client as never, createMany, refundCreateMany };
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


describe('LedgerService — buying an item (P6)', () => {
  type Entry = { account: string; amountPaise: bigint };
  const all = (createMany: ReturnType<typeof vi.fn>): Entry[] =>
    createMany.mock.calls.flatMap((call) => (call[0] as { data: Entry[] }).data);
  const balance = (entries: Entry[], account: string) =>
    entries.filter((e) => e.account === account).reduce((s, e) => s + e.amountPaise, 0n);
  const release = { taskId: 't1', paymentId: 'p1', budgetPaise: 20_000, commissionPaise: 3_000, gstPaise: 0, tcsPaise: 0, tdsPaise: 0, workerPayoutPaise: 17_000 };

  it('cash bill: escrow empties, the worker is repaid apart from earnings, the unspent item money is refunded', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);

    // ₹200 task payment + ₹1,000 item budget held; a ₹950 cash bill approved.
    await service.recordCapture({ taskId: 't1', paymentId: 'p1', amountPaise: 120_000 });
    await service.recordItemSpend({ taskId: 't1', amountPaise: 95_000, route: 'CASH' });
    await service.recordPayout({ taskId: 't1', payoutId: 'po-r', amountPaise: 95_000, kind: 'ITEM_REIMBURSEMENT' });
    await service.recordRelease({ ...release, itemRefundPaise: 5_000 });
    await service.recordPayout({ taskId: 't1', payoutId: 'po-e', amountPaise: 17_000, kind: 'EARNINGS' });

    const entries = all(createMany);
    expect(entries.reduce((s, e) => s + e.amountPaise, 0n)).toBe(0n);
    expect(balance(entries, 'ESCROW')).toBe(0n);
    expect(balance(entries, 'ITEM_REIMBURSABLE')).toBe(0n);
    expect(balance(entries, 'ITEM_PASS_THROUGH')).toBe(95_000n);
    // Earnings never include the item: the worker's settled income is ₹170.
    expect(balance(entries, 'WORKER_SETTLED')).toBe(17_000n);
    expect(balance(entries, 'REFUND')).toBe(5_000n);
    expect(balance(entries, 'PLATFORM_COMMISSION')).toBe(3_000n);
  });

  it('UPI bill above the budget: the top-up is held, the shop is paid, nothing item-related is commissioned', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);

    await service.recordCapture({ taskId: 't1', paymentId: 'p1', amountPaise: 120_000 });
    await service.recordTopUpCapture({ taskId: 't1', amountPaise: 25_000 });
    await service.recordItemSpend({ taskId: 't1', amountPaise: 125_000, route: 'SHOP' });
    await service.recordRelease({ ...release, itemRefundPaise: 0 });

    const entries = all(createMany);
    expect(entries.reduce((s, e) => s + e.amountPaise, 0n)).toBe(0n);
    expect(balance(entries, 'ESCROW')).toBe(0n);
    expect(balance(entries, 'ITEM_PASS_THROUGH')).toBe(125_000n);
    expect(balance(entries, 'REQUESTER_FUNDS')).toBe(-145_000n);
    expect(entries.some((e) => e.account === 'REFUND')).toBe(false);
  });

  it('settles an earnings payout from payable to settled', async () => {
    const { client, createMany } = fakePrisma();
    const service = new LedgerService(client);
    await service.recordPayout({ taskId: 't1', payoutId: 'po1', amountPaise: 17_000 });
    expect(all(createMany).map((e) => [e.account, e.amountPaise])).toEqual([
      ['WORKER_PAYABLE', -17_000n],
      ['WORKER_SETTLED', 17_000n],
    ]);
  });
});

describe('LedgerService — every refund credit queues a gateway refund (docs/22, #4)', () => {
  it('queues the full amount against the task payment', async () => {
    const { client, refundCreateMany } = fakePrisma();
    const service = new LedgerService(client);

    await service.recordFullRefund({ taskId: 't1', paymentId: 'p1', amountPaise: 50_000 });

    expect(refundCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ taskId: 't1', paymentId: 'p1', gateway: 'RAZORPAY', gatewayPaymentId: 'pay_1', amountPaise: 50_000n })],
    });
  });

  it('queues nothing for entries that refund nobody', async () => {
    const { client, refundCreateMany } = fakePrisma();
    const service = new LedgerService(client);

    await service.recordCapture({ taskId: 't1', paymentId: 'p1', amountPaise: 50_000 });
    expect(refundCreateMany).not.toHaveBeenCalled();
  });

  it('splits a refund across the task payment and a top-up, never above what each captured', async () => {
    const { client, refundCreateMany } = fakePrisma({
      payment: { id: 'p1', gateway: 'RAZORPAY', gatewayPaymentId: 'pay_1', amountPaise: 150_000n },
      topUps: [{ id: 'ip1', topUpGateway: 'RAZORPAY', topUpGatewayPaymentId: 'pay_tu', topUpPaise: 25_000n }],
      earlierRefunds: [{ paymentId: 'p1', itemPurchaseId: null, amountPaise: 140_000n }],
    });
    const service = new LedgerService(client);

    await service.recordFullRefund({ taskId: 't1', paymentId: 'p1', amountPaise: 30_000 });

    expect(refundCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ paymentId: 'p1', amountPaise: 10_000n }),
        expect.objectContaining({ itemPurchaseId: 'ip1', gatewayPaymentId: 'pay_tu', amountPaise: 20_000n }),
      ],
    });
  });

  it('refuses a refund larger than everything captured, and writes nothing', async () => {
    const { client, refundCreateMany } = fakePrisma({
      payment: { id: 'p1', gateway: 'MOCK', gatewayPaymentId: null, amountPaise: 10_000n },
    });
    const service = new LedgerService(client);

    await expect(service.recordFullRefund({ taskId: 't1', paymentId: 'p1', amountPaise: 20_000 })).rejects.toThrow(/exceeds/);
    expect(refundCreateMany).not.toHaveBeenCalled();
  });
});

describe('LedgerService — escrow can never be overdrawn (docs/22, #9)', () => {
  it('refuses a refund that would take escrow below zero, such as one booked twice', async () => {
    const { client } = fakePrisma({ escrowAfterPaise: -50_000n });
    const service = new LedgerService(client);

    await expect(service.recordFullRefund({ taskId: 't1', paymentId: 'p1', amountPaise: 50_000 })).rejects.toThrow(/overdraw its escrow/);
  });

  it('allows a release that empties escrow exactly', async () => {
    const { client } = fakePrisma({ escrowAfterPaise: 0n });
    const service = new LedgerService(client);

    await expect(service.recordFullRefund({ taskId: 't1', paymentId: 'p1', amountPaise: 50_000 })).resolves.toBeUndefined();
  });
});
