import { describe, expect, it, vi } from 'vitest';
import { REFUND_MAX_ATTEMPTS, RefundsService } from './refunds.service';

/**
 * docs/22, #4: refunds were bookkeeping only. These pin the parts that
 * decide whether money really goes back, and goes back once.
 */

function refundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rf1',
    taskId: 't1',
    paymentId: 'p1',
    itemPurchaseId: null,
    gateway: 'RAZORPAY',
    gatewayPaymentId: 'pay_1',
    gatewayRefundId: null,
    amountPaise: 50_000n,
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: new Date(0),
    failureReason: null,
    processedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function build(row: ReturnType<typeof refundRow>, options: { claim?: number } = {}) {
  const update = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: options.claim ?? 1 });
  const prisma = {
    refund: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; gatewayRefundId?: string } }) =>
        where.id === row.id || (where.gatewayRefundId && where.gatewayRefundId === row.gatewayRefundId) ? row : null,
      ),
      findMany: vi.fn().mockResolvedValue([]),
      update,
      updateMany,
    },
  };
  const razorpay = {
    createRefund: vi.fn().mockResolvedValue({ id: 'rfnd_1', payment_id: 'pay_1', amount: 50_000, status: 'pending' }),
    findRefund: vi.fn().mockResolvedValue(null),
    fetchRefund: vi.fn(),
    capturedPaymentForOrder: vi.fn(),
  };
  const service = new RefundsService(prisma as never, razorpay as never);
  return { service, update, updateMany, razorpay };
}

describe('RefundsService.process', () => {
  it('settles a mock refund at once', async () => {
    const { service, update, razorpay } = build(refundRow({ gateway: 'MOCK', gatewayPaymentId: null }));

    expect((await service.process('rf1')).acted).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }));
    expect(razorpay.createRefund).not.toHaveBeenCalled();
  });

  it('sends a Razorpay refund for the exact amount and waits for the gateway to settle it', async () => {
    const { service, update, razorpay } = build(refundRow());

    await service.process('rf1');

    expect(razorpay.createRefund).toHaveBeenCalledWith({ gatewayPaymentId: 'pay_1', amountPaise: 50_000, refundId: 'rf1' });
    expect(razorpay.findRefund).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSING', gatewayRefundId: 'rfnd_1' }) }),
    );
  });

  it('on a retry, adopts the refund an unanswered earlier call created instead of sending another', async () => {
    const { service, razorpay, update } = build(refundRow({ status: 'FAILED', attempts: 1 }));
    razorpay.findRefund.mockResolvedValue({ id: 'rfnd_earlier', payment_id: 'pay_1', amount: 50_000, status: 'processed' });

    await service.process('rf1');

    expect(razorpay.findRefund).toHaveBeenCalledWith('pay_1', 'rf1');
    expect(razorpay.createRefund).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED', gatewayRefundId: 'rfnd_earlier' }) }),
    );
  });

  it('sends again when the earlier gateway refund itself failed', async () => {
    const { service, razorpay } = build(refundRow({ status: 'FAILED', attempts: 1 }));
    razorpay.findRefund.mockResolvedValue({ id: 'rfnd_failed', payment_id: 'pay_1', amount: 50_000, status: 'failed' });

    await service.process('rf1');
    expect(razorpay.createRefund).toHaveBeenCalledOnce();
  });

  it('does nothing when another sweeper claimed this attempt first', async () => {
    const { service, razorpay } = build(refundRow(), { claim: 0 });

    expect((await service.process('rf1')).acted).toBe(false);
    expect(razorpay.createRefund).not.toHaveBeenCalled();
  });

  it('records a gateway error and leaves the refund to be retried', async () => {
    const { service, razorpay, update } = build(refundRow());
    razorpay.createRefund.mockRejectedValue({ statusCode: 400, error: { code: 'BAD_REQUEST_ERROR', description: 'The amount exceeds the refundable amount' } });

    expect((await service.process('rf1')).acted).toBe(false);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'rf1' },
      data: { status: 'FAILED', failureReason: '400 BAD_REQUEST_ERROR: The amount exceeds the refundable amount' },
    });
  });

  it('records a bare gateway rejection readably (found live: it was stored as [object Object])', async () => {
    const { service, razorpay, update } = build(refundRow());
    razorpay.createRefund.mockRejectedValue({ statusCode: 404 });

    await service.process('rf1');
    expect(update).toHaveBeenCalledWith({ where: { id: 'rf1' }, data: { status: 'FAILED', failureReason: '{"statusCode":404}' } });
  });

  it('stops after the last attempt', async () => {
    const { service, razorpay } = build(refundRow({ status: 'FAILED', attempts: REFUND_MAX_ATTEMPTS }));

    expect((await service.process('rf1')).acted).toBe(false);
    expect(razorpay.createRefund).not.toHaveBeenCalled();
  });
});

describe('RefundsService.applyGatewayUpdate (refund.* webhooks)', () => {
  it('marks a refund processed', async () => {
    const { service, update } = build(refundRow({ status: 'PROCESSING', gatewayRefundId: 'rfnd_1', attempts: 1 }));

    await service.applyGatewayUpdate({ id: 'rfnd_1', payment_id: 'pay_1', amount: 50_000, status: 'processed' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }));
  });

  it('finds the refund by our id in the notes when the gateway id was never stored', async () => {
    const { service, update } = build(refundRow({ attempts: 1 }));

    await service.applyGatewayUpdate({ id: 'rfnd_9', payment_id: 'pay_1', amount: 50_000, status: 'processed', notes: { onsite_refund_id: 'rf1' } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED', gatewayRefundId: 'rfnd_9' }) }));
  });

  it('never takes a processed refund backwards', async () => {
    const { service, update } = build(refundRow({ status: 'PROCESSED', gatewayRefundId: 'rfnd_1' }));

    await service.applyGatewayUpdate({ id: 'rfnd_1', payment_id: 'pay_1', amount: 50_000, status: 'pending' });
    expect(update).not.toHaveBeenCalled();
  });

  it('a failed gateway refund is queued to be sent again', async () => {
    const { service, update } = build(refundRow({ status: 'PROCESSING', gatewayRefundId: 'rfnd_1', attempts: 1 }));

    await service.applyGatewayUpdate({ id: 'rfnd_1', payment_id: 'pay_1', amount: 50_000, status: 'failed' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', gatewayRefundId: null }) }),
    );
  });
});
