import { Injectable, Logger } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../common/errors';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { RazorpayService } from './razorpay.service';

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
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly razorpay: RazorpayService,
  ) {}

  async createOrder(params: { taskId: string; requesterId: string; idempotencyKey: string }) {
    const env = loadEnv();

    // Idempotency first: a retried request with the same key returns the
    // original result rather than attempting a second capture.
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return this.toView(existing);

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
    // client, per docs/16-security-requirements.md.
    if (env.PAYMENT_PROVIDER === 'razorpay') {
      const order = await this.razorpay.createOrder({
        amountPaise: Number(task.budgetPaise),
        receipt: task.id,
      });

      const payment = await this.prisma.payment.create({
        data: {
          taskId: task.id,
          requesterId: task.requesterId,
          gateway: 'RAZORPAY',
          gatewayOrderId: order.id,
          amountPaise: task.budgetPaise,
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
        amountPaise: task.budgetPaise,
        idempotencyKey: params.idempotencyKey,
        status: 'CAPTURED',
        capturedAt: new Date(),
      },
    });

    await this.ledger.recordCapture({
      taskId: task.id,
      paymentId: payment.id,
      amountPaise: Number(task.budgetPaise),
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

    let payload: { event?: string; payload?: { payment?: { entity?: RazorpayPaymentEntity } } };
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BusinessRuleError('Malformed webhook payload.');
    }

    const paymentEntity = payload.payload?.payment?.entity;
    const eventId = paymentEntity?.id ? `${payload.event}:${paymentEntity.id}` : undefined;

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
      this.logger.warn(`payment.captured for unknown order ${entity.order_id} (payment ${entity.id}).`);
      return;
    }
    if (payment.status === 'CAPTURED') return; // already processed — replay, not an error

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'CAPTURED', gatewayPaymentId: entity.id, capturedAt: new Date() },
    });

    await this.ledger.recordCapture({
      taskId: payment.taskId,
      paymentId: payment.id,
      amountPaise: Number(payment.amountPaise),
    });
  }

  private async failFromWebhook(entity: RazorpayPaymentEntity): Promise<void> {
    const payment = await this.prisma.payment.findFirst({ where: { gatewayOrderId: entity.order_id } });
    if (!payment || payment.status === 'CAPTURED') return;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureReason: entity.error_description ?? 'Payment failed at the gateway.' },
    });
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

  /** docs/07: "GET /payouts/mine | worker | Payout history." */
  async listPayoutsMine(workerId: string, limit: number, cursor?: string) {
    const cursorData = cursor ? decodeCursor<{ createdAt: string; id: string }>(cursor) : null;

    const payouts = await this.prisma.payout.findMany({
      where: {
        workerId,
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

    const hasMore = payouts.length > limit;
    const page = payouts.slice(0, limit);
    const last = page.at(-1);

    return {
      data: page.map((p) => ({
        id: p.id,
        taskId: p.taskId,
        taskTitle: p.task.title,
        amountPaise: Number(p.amountPaise),
        status: p.status,
        processedAt: p.processedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    };
  }

  /** Read by the task service to decide whether DRAFT → PUBLISHED is allowed. */
  async isCaptured(taskId: string): Promise<boolean> {
    const payment = await this.prisma.payment.findUnique({ where: { taskId } });
    return payment?.status === 'CAPTURED';
  }

  /**
   * Full refund on pre-assignment cancellation or expiry. Idempotent: calling
   * it on an already-refunded payment is a no-op rather than a double entry.
   */
  async refundFull(taskId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { taskId } });
    if (!payment || payment.status !== 'CAPTURED') return;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'REFUNDED',
        refundedAt: new Date(),
        refundAmountPaise: payment.amountPaise,
      },
    });

    await this.ledger.recordFullRefund({
      taskId,
      paymentId: payment.id,
      amountPaise: Number(payment.amountPaise),
    });
  }

  /**
   * Release on approval. Marks the payment RELEASED, credits the worker's
   * payable balance in the ledger, and records a PENDING Payout — the amount
   * now owed to the worker, not a transfer that has happened. Idempotent:
   * calling it twice for the same task writes the entries and the Payout row
   * only once, guarded by the payment's own status.
   *
   * No money actually moves anywhere here. A real transfer to a bank account
   * or UPI handle needs a payout gateway and retry handling that is not built
   * in this phase — see the note on `LedgerService.recordRelease` and the
   * scope note in TODO.md. What this method guarantees is that the moment a
   * task is approved, there is an auditable, ledger-backed record of exactly
   * what is owed and to whom, ready for that transfer to read from.
   */
  async release(params: {
    taskId: string;
    commissionPaise: number;
    gstPaise: number;
    tcsPaise: number;
    tdsPaise: number;
    workerPayoutPaise: number;
  }): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { taskId: params.taskId } });
    if (!payment || payment.status !== 'CAPTURED') return;

    const task = await this.prisma.task.findUniqueOrThrow({ where: { id: params.taskId } });
    if (!task.assignedWorkerId) {
      throw new BusinessRuleError('Cannot release payment for a task with no assigned worker.');
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });

    await this.prisma.payout.create({
      data: {
        taskId: params.taskId,
        workerId: task.assignedWorkerId,
        amountPaise: params.workerPayoutPaise,
        status: 'PENDING',
        idempotencyKey: `payout:${params.taskId}`,
      },
    });

    await this.ledger.recordRelease({
      taskId: params.taskId,
      paymentId: payment.id,
      budgetPaise: Number(payment.amountPaise),
      commissionPaise: params.commissionPaise,
      gstPaise: params.gstPaise,
      tcsPaise: params.tcsPaise,
      tdsPaise: params.tdsPaise,
      workerPayoutPaise: params.workerPayoutPaise,
    });
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
