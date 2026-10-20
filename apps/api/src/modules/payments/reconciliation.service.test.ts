import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconciliationService } from './reconciliation.service';
import { resetEnvCache } from '../../config/env';

/** docs/22, #25: the gateway comparison, which needs real Razorpay payments to run live. */

beforeEach(() => {
  resetEnvCache();
  process.env = {
    ...process.env,
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
});

function build(gateway: { status: string; amount: number; amount_refunded?: number }, processedRefundPaise = 0) {
  const prisma = {
    ledgerEntry: { groupBy: vi.fn().mockResolvedValue([]) },
    payment: {
      findMany: vi.fn(async ({ where }: { where: { gateway?: string } }) =>
        where.gateway === 'RAZORPAY' ? [{ id: 'p1', taskId: 't1', gatewayPaymentId: 'pay_1', amountPaise: 50_000n }] : [],
      ),
    },
    refund: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amountPaise: BigInt(processedRefundPaise) } }),
    },
    payout: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const razorpay = { fetchPayment: vi.fn().mockResolvedValue(gateway) };
  return new ReconciliationService(prisma as never, razorpay as never);
}

describe('ReconciliationService — the gateway comparison', () => {
  it('is clean when Razorpay agrees', async () => {
    const report = await build({ status: 'captured', amount: 50_000, amount_refunded: 0 }).run();
    expect(report.findings).toEqual([]);
    expect(report.checked.gatewayPayments).toBe(1);
  });

  it('reports a payment Razorpay does not hold as captured', async () => {
    const report = await build({ status: 'failed', amount: 50_000 }).run();
    expect(report.findings).toEqual([expect.objectContaining({ kind: 'GATEWAY_MISMATCH', taskId: 't1' })]);
  });

  it('reports a different amount', async () => {
    const report = await build({ status: 'captured', amount: 10_000 }).run();
    expect(report.findings[0]?.detail).toContain('Captured 50000 paise here, 10000 at Razorpay');
  });

  it('reports refunds we think are done that Razorpay has not made', async () => {
    const report = await build({ status: 'captured', amount: 50_000, amount_refunded: 0 }, 20_000).run();
    expect(report.findings[0]?.detail).toContain('Refunds processed here 20000 paise, at Razorpay 0');
  });
});
