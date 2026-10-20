import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentsService } from './payments.service';
import { resetEnvCache } from '../../config/env';

/**
 * docs/22, #12: duplicate webhooks must record a capture once, a late
 * failure must never undo a capture, and a lost webhook is recovered by
 * asking the gateway.
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
  RAZORPAY_KEY_ID: 'rzp_test_x',
  RAZORPAY_KEY_SECRET: 'secret',
};

beforeEach(() => {
  resetEnvCache();
  process.env = { ...process.env, ...BASE_ENV };
});

function build(options: { claims?: number[]; pending?: { id: string; gatewayOrderId: string }[] } = {}) {
  const claims = [...(options.claims ?? [1])];
  const paymentUpdateMany = vi.fn(async () => ({ count: claims.shift() ?? 0 }));
  const prisma = {
    payment: {
      updateMany: paymentUpdateMany,
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'p1', taskId: 't1', amountPaise: 50_000n }),
      findMany: vi.fn().mockResolvedValue(options.pending ?? []),
    },
    itemPurchase: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  const ledger = { recordCapture: vi.fn().mockResolvedValue(undefined) };
  const razorpay = { capturedOrderPayment: vi.fn().mockResolvedValue('pay_1') };
  const service = new PaymentsService(prisma as never, ledger as never, razorpay as never, {} as never, {} as never, {} as never);
  return { service, prisma, ledger, razorpay, paymentUpdateMany };
}

describe('PaymentsService.reconcilePending — the lost-webhook backstop', () => {
  it('records a capture the gateway reports for an order still unpaid here', async () => {
    const { service, ledger, razorpay, paymentUpdateMany } = build({ pending: [{ id: 'p1', gatewayOrderId: 'order_1' }] });

    expect(await service.reconcilePending()).toBe(1);
    expect(razorpay.capturedOrderPayment).toHaveBeenCalledWith('order_1');
    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1', status: { in: ['CREATED', 'AUTHORIZED', 'FAILED'] } } }),
    );
    expect(ledger.recordCapture).toHaveBeenCalledOnce();
  });

  it('records nothing when the webhook got there first (the claim finds it already captured)', async () => {
    const { service, ledger } = build({ claims: [0], pending: [{ id: 'p1', gatewayOrderId: 'order_1' }] });

    expect(await service.reconcilePending()).toBe(0);
    expect(ledger.recordCapture).not.toHaveBeenCalled();
  });

  it('leaves an order the gateway has not been paid for', async () => {
    const { service, ledger, razorpay } = build({ pending: [{ id: 'p1', gatewayOrderId: 'order_1' }] });
    razorpay.capturedOrderPayment.mockResolvedValue(null);

    expect(await service.reconcilePending()).toBe(0);
    expect(ledger.recordCapture).not.toHaveBeenCalled();
  });

  it('only looks at orders older than a few minutes', async () => {
    const { service, prisma } = build();
    const now = new Date('2026-10-20T10:00:00Z');

    await service.reconcilePending(now);

    const where = prisma.payment.findMany.mock.calls[0]?.[0].where;
    expect(where.createdAt.lte.getTime()).toBe(now.getTime() - 5 * 60_000);
  });
});

describe('PaymentsService webhooks — duplicates and late failures', () => {
  type Internals = {
    markCaptured(paymentId: string, gatewayPaymentId: string): Promise<boolean>;
    failFromWebhook(entity: { id: string; order_id: string }): Promise<void>;
  };

  it('two deliveries of payment.captured record the capture once', async () => {
    const { service, ledger } = build({ claims: [1, 0] });
    const internals = service as unknown as Internals;

    const results = await Promise.all([internals.markCaptured('p1', 'pay_1'), internals.markCaptured('p1', 'pay_1')]);

    expect(results.sort()).toEqual([false, true]);
    expect(ledger.recordCapture).toHaveBeenCalledOnce();
  });

  it('a payment.failed can only fail a payment that is not yet captured', async () => {
    const { service, paymentUpdateMany } = build();

    await (service as unknown as Internals).failFromWebhook({ id: 'pay_2', order_id: 'order_1' });

    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { gatewayOrderId: 'order_1', status: { in: ['CREATED', 'AUTHORIZED'] } } }),
    );
  });
});
