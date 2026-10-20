import { Injectable, Logger } from '@nestjs/common';
import type { Refund } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RazorpayService, refundReference, type RazorpayRefundEntity } from './razorpay.service';

/** Waits before each retry of a refund the gateway refused or never answered. */
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 60 * 60_000, 3 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000];
/** After this many attempts a refund stops retrying and needs a person. */
export const REFUND_MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;
/** A refund the gateway accepted but has not settled is checked again after this long. */
const POLL_PROCESSING_MS = 30 * 60_000;

/**
 * Sends the refunds the ledger queues (docs/22, #4). LedgerService writes a
 * refund row in the same transaction as every credit to REFUND; this sends
 * each to the gateway and follows it until the gateway says it is processed.
 *
 * Gateway refunds are never sent twice for one row. Each attempt is claimed
 * with a conditional update on the attempt count, so two sweeper replicas
 * cannot both send it. And a call that got no answer may still have reached
 * the gateway, so every retry first asks the gateway for a refund carrying
 * this row's id, and adopts it if there is one.
 *
 * Settlement is confirmed by the `refund.processed` / `refund.failed`
 * webhooks, with a poll for anything that waits too long. A refund the
 * gateway reports failed is retried with backoff; one that keeps failing is
 * logged as an error for a person to act on.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
  ) {}

  /** Sends due refunds and checks on slow ones. Returns how many this pass sent or settled. */
  async sweep(now = new Date()): Promise<number> {
    const due = await this.prisma.refund.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        attempts: { lt: REFUND_MAX_ATTEMPTS },
        nextAttemptAt: { lte: now },
      },
      select: { id: true },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50,
    });
    const slow = await this.prisma.refund.findMany({
      where: { status: 'PROCESSING', updatedAt: { lte: new Date(now.getTime() - POLL_PROCESSING_MS) } },
      select: { id: true },
      take: 50,
    });

    let acted = 0;
    for (const { id } of due) {
      try {
        if ((await this.process(id, now)).acted) acted += 1;
      } catch (error) {
        this.logger.error(`Refund ${id} could not be processed: ${String(error)}`);
      }
    }
    for (const { id } of slow) {
      try {
        if (await this.poll(id)) acted += 1;
      } catch (error) {
        this.logger.warn(`Refund ${id} status check failed: ${String(error)}`);
      }
    }
    return acted;
  }

  /** One attempt at sending a refund to the gateway. */
  async process(refundId: string, now = new Date()): Promise<{ acted: boolean }> {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund || (refund.status !== 'PENDING' && refund.status !== 'FAILED')) return { acted: false };
    if (refund.attempts >= REFUND_MAX_ATTEMPTS) return { acted: false };

    // Claim this attempt. The next attempt time is set before the call, so
    // a crash mid-call leaves the row to be retried (and reconciled) later.
    const wait = RETRY_BACKOFF_MS[Math.min(refund.attempts, RETRY_BACKOFF_MS.length - 1)] ?? 0;
    const claimed = await this.prisma.refund.updateMany({
      where: { id: refund.id, status: refund.status, attempts: refund.attempts },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + wait) },
    });
    if (claimed.count === 0) return { acted: false };
    const attempt = refund.attempts + 1;

    if (refund.gateway === 'MOCK') {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: 'PROCESSED', gatewayRefundId: `mock_rfnd_${refund.id}`, processedAt: now, failureReason: null },
      });
      return { acted: true };
    }

    try {
      const gatewayPaymentId = await this.gatewayPaymentId(refund);
      // An earlier attempt may have reached the gateway without an answer.
      const earlier = refund.attempts > 0 ? await this.razorpay.findRefund(gatewayPaymentId, refund.id) : null;
      const entity =
        earlier && earlier.status !== 'failed'
          ? earlier
          : await this.razorpay.createRefund({ gatewayPaymentId, amountPaise: Number(refund.amountPaise), refundId: refund.id });
      await this.apply(refund, entity, now);
      return { acted: true };
    } catch (error) {
      const reason = describeGatewayError(error);
      await this.prisma.refund.update({ where: { id: refund.id }, data: { status: 'FAILED', failureReason: reason } });
      if (attempt >= REFUND_MAX_ATTEMPTS) {
        this.logger.error(`Refund ${refund.id} of task ${refund.taskId} failed ${attempt} times and needs a person: ${reason}`);
      } else {
        this.logger.warn(`Refund ${refund.id} attempt ${attempt} failed, will retry: ${reason}`);
      }
      return { acted: false };
    }
  }

  /** Asks the gateway about a refund it accepted but has not settled. */
  async poll(refundId: string): Promise<boolean> {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund || refund.status !== 'PROCESSING' || !refund.gatewayRefundId || !refund.gatewayPaymentId) return false;
    const entity = await this.razorpay.fetchRefund(refund.gatewayPaymentId, refund.gatewayRefundId);
    await this.apply(refund, entity, new Date());
    return entity.status !== 'pending';
  }

  /** A `refund.*` webhook: the gateway's word on a refund it holds. */
  async applyGatewayUpdate(entity: RazorpayRefundEntity): Promise<void> {
    const reference = refundReference(entity);
    const refund =
      (await this.prisma.refund.findUnique({ where: { gatewayRefundId: entity.id } })) ??
      (reference ? await this.prisma.refund.findUnique({ where: { id: reference } }) : null);
    if (!refund) {
      this.logger.warn(`Gateway refund ${entity.id} (payment ${entity.payment_id}) matches no refund here.`);
      return;
    }
    await this.apply(refund, entity, new Date());
  }

  private async apply(refund: Refund, entity: RazorpayRefundEntity, now: Date): Promise<void> {
    // A late or replayed update never takes a settled refund backwards.
    if (refund.status === 'PROCESSED') return;
    // A failed gateway refund that is not this row's current one is history.
    if (refund.gatewayRefundId && refund.gatewayRefundId !== entity.id && entity.status === 'failed') return;

    if (entity.status === 'processed') {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: 'PROCESSED', gatewayRefundId: entity.id, gatewayPaymentId: entity.payment_id, processedAt: now, failureReason: null },
      });
      this.logger.log(`Refund ${refund.id} of task ${refund.taskId} processed by the gateway (${entity.id}).`);
    } else if (entity.status === 'pending') {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: 'PROCESSING', gatewayRefundId: entity.id, gatewayPaymentId: entity.payment_id },
      });
    } else {
      const wait = RETRY_BACKOFF_MS[Math.min(refund.attempts, RETRY_BACKOFF_MS.length - 1)] ?? 0;
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'FAILED',
          gatewayRefundId: null,
          failureReason: `The gateway reported refund ${entity.id} failed.`,
          nextAttemptAt: new Date(now.getTime() + wait),
        },
      });
      this.logger.warn(`Gateway refund ${entity.id} for refund ${refund.id} failed; it will be sent again.`);
    }
  }

  /** The gateway payment to refund against, looked up from the order once if it was never stored. */
  private async gatewayPaymentId(refund: Refund): Promise<string> {
    if (refund.gatewayPaymentId) return refund.gatewayPaymentId;

    let paymentId: string | null = null;
    let orderId: string | null = null;
    if (refund.paymentId) {
      const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
      paymentId = payment.gatewayPaymentId;
      orderId = payment.gatewayOrderId;
    } else if (refund.itemPurchaseId) {
      const purchase = await this.prisma.itemPurchase.findUniqueOrThrow({ where: { id: refund.itemPurchaseId } });
      paymentId = purchase.topUpGatewayPaymentId;
      orderId = purchase.topUpGatewayOrderId;
    }
    if (!paymentId && orderId) paymentId = await this.razorpay.capturedPaymentForOrder(orderId);
    if (!paymentId) throw new Error('No captured gateway payment found to refund against.');

    await this.prisma.refund.update({ where: { id: refund.id }, data: { gatewayPaymentId: paymentId } });
    return paymentId;
  }
}

/** The SDK rejects with `{ statusCode, error: { code, description } }`, sometimes with no `error` at all. */
function describeGatewayError(error: unknown): string {
  const e = error as { statusCode?: number; error?: { code?: string; description?: string } };
  if (e?.error?.description) return `${e.statusCode ?? ''} ${e.error.code ?? ''}: ${e.error.description}`.trim();
  if (error instanceof Error) return error.message;
  // e.g. a bare `{ statusCode: 404 }`, which String() would print as [object Object].
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
