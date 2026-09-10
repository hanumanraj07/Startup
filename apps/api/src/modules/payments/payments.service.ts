import { Injectable } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../common/errors';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from './ledger.service';

/**
 * Order creation and capture.
 *
 * SCOPE OF THIS PHASE: capture only, mock provider only. A requester funds a
 * draft task and the funds move to escrow, which is what the DRAFT →
 * PUBLISHED gate in transitions.ts checks for. This exists now, ahead of
 * Phase 6 proper, because the task lifecycle cannot be tested end to end
 * without something backing that gate — the alternative was letting a task
 * publish on trust, which is exactly the guarantee this product exists to
 * not make.
 *
 * NOT built here, and left to Phase 6: real Razorpay Route integration,
 * release, refund, payout, webhook verification, and idempotent retry of a
 * failed capture. Calling this with PAYMENT_PROVIDER=razorpay throws rather
 * than pretending to work — matching the same honesty applied to Google
 * sign-in, which also is not built without real credentials to verify it
 * against.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
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

    if (env.PAYMENT_PROVIDER !== 'mock') {
      throw new BusinessRuleError(
        'Live payments are not available yet. This deployment is not configured with real Razorpay credentials.',
      );
    }

    // Amount is read from the task record. It is never accepted from the
    // client, per docs/16-security-requirements.md.
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
    amountPaise: bigint;
    capturedAt: Date | null;
  }) {
    return {
      id: payment.id,
      taskId: payment.taskId,
      status: payment.status,
      amountPaise: Number(payment.amountPaise),
      capturedAt: payment.capturedAt?.toISOString() ?? null,
    };
  }
}
