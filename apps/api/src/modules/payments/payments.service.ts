import { Injectable, Logger } from '@nestjs/common';
import type { PaymentStatus } from '@prisma/client';
import { requesterTotal } from '@onsite/money';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../common/errors';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { RazorpayService, type RazorpayRefundEntity } from './razorpay.service';
import { RefundsService } from './refunds.service';
import { ModerationService } from '../moderation/moderation.service';
import { PayoutsService } from './payouts.service';

/**
 * Order creation, capture, and (for the real provider) webhook-driven
 * settlement.
 *
 * Two providers, one interface: `mock` captures instantly and is what every
 * other phase of this project has been tested against; `razorpay` creates a
 * real order and does NOT capture here — capture only ever happens in
 * `handleWebhook`, once Razorpay's own signed callback confirms it. A
 * requester's browser completing checkout is never itself trusted to move
 * money state forward, per docs/16-security-requirements.md and docs/11's
 * "the webhook is the only thing that moves payment state forward."
 */
/** Payment statuses a gateway capture may still move to CAPTURED. */
const CAPTURABLE: PaymentStatus[] = ['CREATED', 'AUTHORIZED', 'FAILED'];
/** An order unpaid for this long without a webhook is asked about directly. */
const RECONCILE_AFTER_MS = 5 * 60_000;
/** Orders older than this are left alone: Razorpay order payments do not arrive days later. */
const RECONCILE_FOR_MS = 3 * 24 * 3_600_000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly razorpay: RazorpayService,
    private readonly moderation: ModerationService,
    private readonly payouts: PayoutsService,
    private readonly refunds: RefundsService,
  ) {}

  async createOrder(params: { taskId: string; requesterId: string; idempotencyKey: string }) {
    const env = loadEnv();

    // Idempotency first: a retried request with the same key returns the
    // original result rather than attempting a second capture.
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return this.toView(existing);

    // No money is taken from someone inside a moderation cooldown: the
    // task could not be published until it ends, so the charge would only
    // sit there. Checked after the idempotency replay so a retry of an order
    // created before the cooldown still returns it.
    await this.moderation.assertNotRestricted(params.requesterId);

    const task = await this.prisma.task.findUnique({ where: { id: params.taskId } });
    if (!task) throw new NotFoundError('Task not found.');
    if (task.requesterId !== params.requesterId) {
      throw new NotFoundError('Task not found.');
    }
    if (task.status !== 'DRAFT') {
      throw new BusinessRuleError('Only a draft task can be funded.');
    }

    const already = await this.prisma.payment.findUnique({ where: { taskId: task.id } });
    if (already) return this.toView(already);

    // Amount is read from the task record. It is never accepted from the
    // client, per docs/16-security-requirements.md. It is the task payment
    // plus any item budget, captured together and held in escrow.
    const amountPaise = requesterTotal(Number(task.budgetPaise), Number(task.itemBudgetPaise));
    if (env.PAYMENT_PROVIDER === 'razorpay') {
      const order = await this.razorpay.createOrder({
        amountPaise,
        receipt: task.id,
      });

      const payment = await this.prisma.payment.create({
        data: {
          taskId: task.id,
          requesterId: task.requesterId,
          gateway: 'RAZORPAY',
          gatewayOrderId: order.id,
          amountPaise,
          idempotencyKey: params.idempotencyKey,
          status: 'CREATED',
        },
      });

      return this.toView(payment);
    }

    const payment = await this.prisma.payment.create({
      data: {
        taskId: task.id,
        requesterId: task.requesterId,
        gateway: 'MOCK',
        amountPaise,
        idempotencyKey: params.idempotencyKey,
        status: 'CAPTURED',
        capturedAt: new Date(),
      },
    });

    await this.ledger.recordCapture({
      taskId: task.id,
      paymentId: payment.id,
      amountPaise,
    });

    return this.toView(payment);
  }

  /**
   * The only thing allowed to move a Razorpay-backed payment from CREATED to
   * CAPTURED. Verifies the signature over the raw body before touching
   * anything else, records the event (verified or not) for audit, and is
   * replay-safe: `WebhookEvent.eventId` is unique, so a gateway's deliberate
   * retry of an already-processed event is a no-op, not a double capture.
   */
  async handleWebhook(rawBody: Buffer, signatureHeader: string | undefined): Promise<{ received: true }> {
    const signatureVerified = this.razorpay.verifyWebhookSignature(rawBody, signatureHeader);

    let payload: {
      event?: string;
      payload?: { payment?: { entity?: RazorpayPaymentEntity }; refund?: { entity?: RazorpayRefundEntity } };
    };
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BusinessRuleError('Malformed webhook payload.');
    }

    const paymentEntity = payload.payload?.payment?.entity;
    // A refund event names the refund: one payment can have several refunds,
    // each with its own processed/failed events.
    const refundEntity = payload.payload?.refund?.entity;
    const entityId = refundEntity?.id ?? paymentEntity?.id;
    const eventId = entityId ? `${payload.event}:${entityId}` : undefined;

    if (!signatureVerified || !eventId) {
      // Recorded even when unverified — a forged or malformed delivery is
      // itself something worth an audit trail of, not silently dropped.
      await this.prisma.webhookEvent
        .create({
          data: {
            gateway: 'RAZORPAY',
            eventId: eventId ?? `unverified:${Date.now()}:${Math.random()}`,
            eventType: payload.event ?? 'unknown',
            payload: payload as object,
            signatureVerified,
          },
        })
        .catch(() => undefined); // best-effort audit row; never block the 401 below on it
      throw new BusinessRuleError('Invalid webhook signature.');
    }

    const existing = await this.prisma.webhookEvent.findUnique({ where: { eventId } });
    if (existing?.processedAt) {
      return { received: true };
    }

    const event = await this.prisma.webhookEvent.upsert({
      where: { eventId },
      create: {
        gateway: 'RAZORPAY',
        eventId,
        eventType: payload.event ?? 'unknown',
        payload: payload as object,
        signatureVerified,
      },
      update: {},
    });

    try {
      if (payload.event === 'payment.captured' && paymentEntity) {
        await this.captureFromWebhook(paymentEntity);
      } else if (payload.event === 'payment.failed' && paymentEntity) {
        await this.failFromWebhook(paymentEntity);
      } else if (payload.event?.startsWith('refund.') && refundEntity) {
        await this.refunds.applyGatewayUpdate(refundEntity);
      }
      await this.prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    } catch (error) {
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processingError: String(error) },
      });
      this.logger.error(`Webhook ${eventId} processing failed: ${String(error)}`);
      throw error;
    }

    return { received: true };
  }

  private async captureFromWebhook(entity: RazorpayPaymentEntity): Promise<void> {
    const payment = await this.prisma.payment.findFirst({ where: { gatewayOrderId: entity.order_id } });
    if (!payment) {
      // Not a task's own payment: it may be an item top-up the requester
      // paid to approve a bill above the budget.
      const purchase = await this.prisma.itemPurchase.findUnique({ where: { topUpGatewayOrderId: entity.order_id } });
      if (purchase) {
        await this.captureTopUp(purchase.id, entity.id);
        return;
      }
      this.logger.warn(`payment.captured for unknown order ${entity.order_id} (payment ${entity.id}).`);
      return;
    }
    await this.markCaptured(payment.id, entity.id);
  }

  /**
   * CREATED (or FAILED: a later attempt on the same order can succeed) to
   * CAPTURED, with the escrow entry, in one transaction. The conditional
   * claim means two deliveries of the same webhook arriving together, or the
   * webhook and the poller, record the capture once (docs/22, #12). Returns
   * whether this call recorded it.
   */
  private async markCaptured(paymentId: string, gatewayPaymentId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: CAPTURABLE } },
        data: { status: 'CAPTURED', gatewayPaymentId, capturedAt: new Date(), failureReason: null },
      });
      if (claimed.count === 0) return false; // already captured — a replay, not an error
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      await this.ledger.recordCapture(
        { taskId: payment.taskId, paymentId: payment.id, amountPaise: Number(payment.amountPaise) },
        tx,
      );
      return true;
    });
  }

  private async failFromWebhook(entity: RazorpayPaymentEntity): Promise<void> {
    // Conditional, so a failed attempt reported after (or alongside) a
    // successful one never takes a captured payment back to FAILED.
    await this.prisma.payment.updateMany({
      where: { gatewayOrderId: entity.order_id, status: { in: ['CREATED', 'AUTHORIZED'] } },
      data: { status: 'FAILED', failureReason: entity.error_description ?? 'Payment failed at the gateway.' },
    });
  }

  /**
   * The webhook's backstop (docs/22, #12). A webhook can be lost: the server
   * was down, the secret was wrong, the gateway gave up retrying. The
   * customer has paid but the task never publishes. Every order still
   * unpaid after a few minutes is asked about directly, and a capture the
   * gateway reports is recorded exactly as the webhook would have. Covers
   * task payments and item top-ups. Run by the sweeper.
   */
  async reconcilePending(now = new Date()): Promise<number> {
    const env = loadEnv();
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return 0;
    const window = { lte: new Date(now.getTime() - RECONCILE_AFTER_MS), gte: new Date(now.getTime() - RECONCILE_FOR_MS) };

    const [payments, topUps] = await Promise.all([
      this.prisma.payment.findMany({
        where: { gateway: 'RAZORPAY', status: { in: CAPTURABLE }, gatewayOrderId: { not: null }, createdAt: window },
        select: { id: true, gatewayOrderId: true },
        take: 50,
      }),
      this.prisma.itemPurchase.findMany({
        where: { topUpGateway: 'RAZORPAY', topUpGatewayOrderId: { not: null }, topUpCapturedAt: null, updatedAt: window },
        select: { id: true, topUpGatewayOrderId: true },
        take: 50,
      }),
    ]);

    let recorded = 0;
    for (const p of payments) {
      try {
        const gatewayPaymentId = p.gatewayOrderId ? await this.razorpay.capturedOrderPayment(p.gatewayOrderId) : null;
        if (gatewayPaymentId && (await this.markCaptured(p.id, gatewayPaymentId))) {
          recorded += 1;
          this.logger.warn(`Payment ${p.id} was captured at the gateway with no webhook; recorded by the poller.`);
        }
      } catch (error) {
        this.logger.warn(`Could not check order ${p.gatewayOrderId} with the gateway: ${String(error)}`);
      }
    }
    for (const t of topUps) {
      try {
        const gatewayPaymentId = t.topUpGatewayOrderId ? await this.razorpay.capturedOrderPayment(t.topUpGatewayOrderId) : null;
        if (gatewayPaymentId) {
          await this.captureTopUp(t.id, gatewayPaymentId);
          recorded += 1;
          this.logger.warn(`Top-up for bill ${t.id} was captured at the gateway with no webhook; recorded by the poller.`);
        }
      } catch (error) {
        this.logger.warn(`Could not check top-up order ${t.topUpGatewayOrderId} with the gateway: ${String(error)}`);
      }
    }
    return recorded;
  }

  async getForTask(taskId: string, requesterId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { taskId } });
    if (!payment) throw new NotFoundError('No payment found for this task.');
    if (payment.requesterId !== requesterId) throw new ForbiddenError('Not your payment.');
    return this.toView(payment);
  }

  /**
   * docs/07-api-specification.md: "GET /payments/mine | requester | Payment
   * history." Same cursor-pagination shape as TasksService.listMine and
   * ChatService.list — newest first, opaque cursor, never an unbounded list.
   */
  async listMine(requesterId: string, limit: number, cursor?: string) {
    const cursorData = cursor ? decodeCursor<{ createdAt: string; id: string }>(cursor) : null;

    const payments = await this.prisma.payment.findMany({
      where: {
        requesterId,
        ...(cursorData && {
          OR: [
            { createdAt: { lt: new Date(cursorData.createdAt) } },
            { createdAt: new Date(cursorData.createdAt), id: { lt: cursorData.id } },
          ],
        }),
      },
      include: { task: { select: { title: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = payments.length > limit;
    const page = payments.slice(0, limit);
    const last = page.at(-1);

    return {
      data: page.map((p) => ({ ...this.toView(p), taskTitle: p.task.title, createdAt: p.createdAt.toISOString() })),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    };
  }

  /**
   * Starts the top-up for a bill above what is left of the item budget. The
   * mock provider captures at once; Razorpay returns an order for checkout,
   * and the top-up is captured only by its signed webhook (captureTopUp).
   * Idempotent: a bill has at most one top-up order.
   */
  async startTopUp(purchaseId: string): Promise<{ captured: boolean; razorpay?: { orderId: string; keyId: string | null } }> {
    const env = loadEnv();
    const purchase = await this.prisma.itemPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
    const amountPaise = Number(purchase.topUpPaise);
    if (amountPaise <= 0) return { captured: true };
    if (purchase.topUpCapturedAt) return { captured: true };

    if (env.PAYMENT_PROVIDER === 'razorpay') {
      let orderId = purchase.topUpGatewayOrderId;
      if (!orderId) {
        // Razorpay caps receipts at 40 characters.
        const order = await this.razorpay.createOrder({ amountPaise, receipt: `tu-${purchase.id}` });
        const claimed = await this.prisma.itemPurchase.updateMany({
          where: { id: purchase.id, topUpGatewayOrderId: null },
          data: { topUpGateway: 'RAZORPAY', topUpGatewayOrderId: order.id },
        });
        orderId = claimed.count > 0
          ? order.id
          : (await this.prisma.itemPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).topUpGatewayOrderId;
      }
      return { captured: false, razorpay: { orderId: orderId ?? '', keyId: env.RAZORPAY_KEY_ID ?? null } };
    }

    await this.prisma.itemPurchase.update({ where: { id: purchase.id }, data: { topUpGateway: 'MOCK' } });
    await this.captureTopUp(purchase.id);
    return { captured: true };
  }

  /**
   * A top-up's money is held: escrow grows by it and so does the task's item
   * top-up. The conditional update makes a replayed webhook a no-op.
   */
  async captureTopUp(purchaseId: string, gatewayPaymentId?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.itemPurchase.updateMany({
        where: { id: purchaseId, topUpCapturedAt: null },
        // The gateway payment is kept so unspent top-up money can be
        // refunded against it.
        data: { topUpCapturedAt: new Date(), ...(gatewayPaymentId && { topUpGatewayPaymentId: gatewayPaymentId }) },
      });
      if (claimed.count === 0) return;
      const purchase = await tx.itemPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
      await tx.task.update({
        where: { id: purchase.taskId },
        data: { itemTopUpPaise: { increment: purchase.topUpPaise } },
      });
      await this.ledger.recordTopUpCapture({ taskId: purchase.taskId, amountPaise: Number(purchase.topUpPaise) }, tx);
    });
  }

  /**
   * The task's payment, if one was ever started: its status and the amount
   * it covers. Read by the task service to freeze a draft's price once
   * payment has begun, and to check at publish that what was captured is
   * what the task owes.
   */
  async forTask(taskId: string): Promise<{ status: PaymentStatus; amountPaise: bigint } | null> {
    return this.prisma.payment.findUnique({ where: { taskId }, select: { status: true, amountPaise: true } });
  }

  /**
   * Full refund on pre-assignment cancellation or expiry. Idempotent: calling
   * it on an already-refunded payment is a no-op rather than a double entry.
   */
  async refundFull(taskId: string): Promise<boolean> {
    const payment = await this.prisma.payment.findUnique({ where: { taskId } });
    if (!payment || payment.status !== 'CAPTURED') return false;

    // Conditional claim: of two callers racing (the live path and the
    // stranded-money sweep), only the one whose write still finds CAPTURED
    // goes on to write ledger entries.
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'CAPTURED' },
      data: {
        status: 'REFUNDED',
        refundedAt: new Date(),
        refundAmountPaise: payment.amountPaise,
      },
    });
    if (claimed.count === 0) return false;

    await this.ledger.recordFullRefund({
      taskId,
      paymentId: payment.id,
      amountPaise: Number(payment.amountPaise),
    });
    return true;
  }

  /**
   * Release on approval. Marks the payment RELEASED, credits the worker's
   * payable balance in the ledger, and records a PENDING Payout — the amount
   * now owed to the worker — which PayoutsService then sends. Idempotent:
   * calling it twice for the same task writes the entries and the Payout row
   * only once, guarded by the payment's own status.
   *
   * With an item, the approved bill has already left escrow (paid to the
   * shop, or owed back to the worker at the handover), so whatever item money
   * escrow still holds is refunded. Commission is on the task payment only.
   */
  async release(params: {
    taskId: string;
    commissionPaise: number;
    gstPaise: number;
    tcsPaise: number;
    tdsPaise: number;
    workerPayoutPaise: number;
  }, options: { sendNow?: boolean } = {}): Promise<boolean> {
    const payment = await this.prisma.payment.findUnique({ where: { taskId: params.taskId } });
    if (!payment || payment.status !== 'CAPTURED') return false;

    const task = await this.prisma.task.findUniqueOrThrow({ where: { id: params.taskId } });
    if (!task.assignedWorkerId) {
      throw new BusinessRuleError('Cannot release payment for a task with no assigned worker.');
    }

    const budgetPaise = Number(task.budgetPaise);
    const itemRefundPaise = await this.heldItemPaise(task.id, budgetPaise);

    // Conditional claim, as in refundFull: only one caller releases.
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'CAPTURED' },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
        ...(itemRefundPaise > 0 && { refundAmountPaise: itemRefundPaise, refundedAt: new Date() }),
      },
    });
    if (claimed.count === 0) return false;

    await this.payouts.recordOwed({
      taskId: params.taskId,
      workerId: task.assignedWorkerId,
      earningsPaise: params.workerPayoutPaise,
    });

    await this.ledger.recordRelease({
      taskId: params.taskId,
      paymentId: payment.id,
      budgetPaise,
      commissionPaise: params.commissionPaise,
      gstPaise: params.gstPaise,
      tcsPaise: params.tcsPaise,
      tdsPaise: params.tdsPaise,
      workerPayoutPaise: params.workerPayoutPaise,
      itemRefundPaise,
    });

    // A caller that has not yet written the task's own final status (a
    // dispute decision) sends afterwards, so the payout can mark it paid.
    if (options.sendNow !== false) await this.payouts.sendOwed(task.assignedWorkerId);
    return true;
  }

  /**
   * Item money escrow still holds: everything held less the task payment.
   * Read from the ledger, never from a reported cost. Escrow holding less
   * than the task payment would be a defect, so it throws rather than pays.
   */
  async heldItemPaise(taskId: string, taskPaymentPaise: number): Promise<number> {
    const held = await this.ledger.escrowBalance(taskId);
    if (held < taskPaymentPaise) {
      throw new Error(`Escrow for task ${taskId} holds ${held} paise, less than its task payment. This is a defect.`);
    }
    return held - taskPaymentPaise;
  }

  private toView(payment: {
    id: string;
    taskId: string;
    status: string;
    gateway: string;
    gatewayOrderId: string | null;
    amountPaise: bigint;
    capturedAt: Date | null;
  }) {
    const env = loadEnv();
    return {
      id: payment.id,
      taskId: payment.taskId,
      status: payment.status,
      amountPaise: Number(payment.amountPaise),
      capturedAt: payment.capturedAt?.toISOString() ?? null,
      // Only present for the real gateway — the mock path has nothing for a
      // client to check out with. `keyId` is Razorpay's public key: safe to
      // return, it's meant to be embedded in browser-side Checkout code.
      ...(payment.gateway === 'RAZORPAY' && payment.gatewayOrderId
        ? { razorpay: { orderId: payment.gatewayOrderId, keyId: env.RAZORPAY_KEY_ID ?? null } }
        : {}),
    };
  }
}

/** The subset of Razorpay's payment.entity webhook payload this codebase reads. */
interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  error_description?: string;
}
