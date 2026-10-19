import { Injectable, Logger } from '@nestjs/common';
import type { PayoutAccount } from '@prisma/client';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { BusinessRuleError } from '../../common/errors';
import { loadEnv, payoutProvider } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { checkTransition } from '../tasks/transitions';
import { LedgerService } from './ledger.service';

/** Why a transfer did not go through, in words a worker can act on. */
export class PayoutTransferError extends Error {}

interface PayoutDriver {
  transfer(params: { payoutId: string; amountPaise: number; account: PayoutAccount }): Promise<{ reference: string }>;
  /** Pays a shop's UPI ID directly, for an item bill the requester approved. */
  payVpa(params: { reference: string; amountPaise: number; vpa: string }): Promise<{ reference: string }>;
}

/**
 * Settles instantly, for development and tests. An account number ending
 * 0000, or a UPI ID containing "fail", is declined, so the failure and retry
 * paths can be exercised the same way a gateway's test mode does.
 */
const mockDriver: PayoutDriver = {
  async transfer({ payoutId, account }) {
    if (account.type === 'BANK' && account.accountNumberMasked?.endsWith('0000')) {
      throw new PayoutTransferError('The bank declined the transfer. Check the account number and IFSC.');
    }
    return { reference: `MOCK${payoutId.replace(/-/g, '').slice(-12).toUpperCase()}` };
  },
  async payVpa({ reference, vpa }) {
    if (vpa.toLowerCase().includes('fail')) {
      throw new PayoutTransferError('The shop’s UPI ID did not accept the payment. Check it with the shop.');
    }
    return { reference: `MOCKUPI${reference.replace(/-/g, '').slice(-10).toUpperCase()}` };
  },
};

/** Retry gaps after a failed transfer: 5 minutes, then 30, then hourly. */
const RETRY_BACKOFF_MS = [5 * 60_000, 30 * 60_000, 60 * 60_000];
/** A transfer this long in PROCESSING without an answer is treated as failed and retried. */
const STUCK_PROCESSING_MS = 15 * 60_000;

export interface PayoutSummary {
  provider: 'mock' | 'none';
  /** Owed and waiting to be sent: PENDING plus FAILED (which will be retried). */
  availablePaise: number;
  /** Sent, not yet confirmed. */
  processingPaise: number;
  /** Confirmed in the worker's account. */
  paidPaise: number;
  /** Lifetime earnings from tasks, excluding item reimbursements. */
  earnedPaise: number;
  /** Lifetime item reimbursements. Not earnings. */
  reimbursedPaise: number;
  failedCount: number;
  /** Payouts wait for a verified identity (level 2+) as well as a verified account. */
  identityVerified: boolean;
  /** The account payouts go to, or null when there is none that is verified. */
  account: { id: string; type: 'BANK' | 'UPI'; label: string } | null;
}

/**
 * What the platform owes workers, and sending it to them.
 *
 * A Payout row is created PENDING the moment a task's payment is released
 * (approval, auto-approval, or a dispute decided for the worker): an
 * auditable record of exactly what is owed. It is then sent to the worker's
 * verified default payout account — straight away when one exists, by the
 * sweeper otherwise, and again after a failure, with backoff. Each transfer
 * is claimed with a conditional update first, so two processes can never
 * send the same payout twice; and the ledger's WORKER_PAYABLE → WORKER_SETTLED
 * entry is written only once the transfer is confirmed.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationService,
    private readonly publisher: RealtimePublisher,
  ) {}

  /**
   * Records what a worker is owed for a task. Idempotent on the task: the
   * payout's idempotency key is unique, so a second call returns the first
   * row rather than owing the worker twice.
   */
  async recordOwed(params: { taskId: string; workerId: string; earningsPaise: number }) {
    const idempotencyKey = `payout:${params.taskId}`;
    const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;
    return this.prisma.payout.create({
      data: {
        taskId: params.taskId,
        workerId: params.workerId,
        kind: 'EARNINGS',
        amountPaise: params.earningsPaise,
        status: 'PENDING',
        idempotencyKey,
      },
    });
  }

  /**
   * Records the cash a worker paid at a shop as owed back to them, apart from
   * their earnings and sent straight away rather than on approval: the
   * requester's handover code has already confirmed the item. Idempotent on
   * the bill.
   */
  async recordReimbursement(params: { taskId: string; workerId: string; purchaseId: string; amountPaise: number }) {
    const idempotencyKey = `reimburse:${params.purchaseId}`;
    const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;
    return this.prisma.payout.create({
      data: {
        taskId: params.taskId,
        workerId: params.workerId,
        kind: 'ITEM_REIMBURSEMENT',
        amountPaise: params.amountPaise,
        reimbursementPaise: params.amountPaise,
        status: 'PENDING',
        idempotencyKey,
      },
    });
  }

  /** Whether the platform can pay a shop's UPI ID at all (a payout partner is switched on). */
  canPayShops(): boolean {
    return payoutProvider() !== 'none';
  }

  /**
   * Pays a shop's UPI ID for an approved bill. Throws PayoutTransferError
   * with words the worker can act on when the transfer is refused. The
   * caller owns the claim and the ledger entry.
   */
  async payShop(params: { purchaseId: string; amountPaise: number; vpa: string }): Promise<{ reference: string }> {
    if (!this.canPayShops()) {
      throw new PayoutTransferError('Paying shops directly is not switched on yet. Pay cash instead, if the shop allows it.');
    }
    return mockDriver.payVpa({ reference: params.purchaseId, amountPaise: params.amountPaise, vpa: params.vpa });
  }

  /** Best-effort: sends everything a worker is owed now. Never throws; the sweeper is the guarantee. */
  async sendOwed(workerId: string): Promise<void> {
    try {
      const owed = await this.prisma.payout.findMany({
        where: { workerId, status: { in: ['PENDING', 'FAILED'] } },
        select: { id: true },
      });
      for (const payout of owed) await this.process(payout.id);
    } catch (error) {
      this.logger.warn(`Sending payouts for worker ${workerId} failed: ${String(error)}`);
    }
  }

  /**
   * The worker's "Pay out now". Everything owed goes to the verified default
   * account; a failed transfer is retried immediately rather than waiting
   * for its backoff, since the worker may just have fixed their account.
   */
  async settleMine(workerId: string): Promise<PayoutSummary> {
    if (payoutProvider() === 'none') {
      throw new BusinessRuleError('Payouts are not switched on yet. Your earnings are safe and will be sent once they are.');
    }
    const worker = await this.prisma.user.findUniqueOrThrow({ where: { id: workerId }, select: { verificationLevel: true } });
    if (worker.verificationLevel < 2) {
      throw new BusinessRuleError('Verify your identity first. Your earnings are safe and will be sent once you have.');
    }
    if (!(await this.payoutAccount(workerId))) {
      throw new BusinessRuleError('Add and verify a bank account or UPI ID first.');
    }
    await this.sendOwed(workerId);
    return this.summary(workerId);
  }

  /**
   * Sends one payout. Safe to call any number of times from anywhere: only a
   * PENDING or FAILED payout is touched, and only the caller whose
   * conditional update claims it actually transfers.
   */
  async process(payoutId: string): Promise<{ acted: boolean }> {
    if (payoutProvider() === 'none') return { acted: false };

    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId }, include: { task: true } });
    if (!payout || (payout.status !== 'PENDING' && payout.status !== 'FAILED')) return { acted: false };
    if (payout.attempts >= loadEnv().PAYOUT_MAX_ATTEMPTS) return { acted: false };

    const account = await this.payoutAccount(payout.workerId);
    if (!account) return { acted: false };

    const claimed = await this.prisma.payout.updateMany({
      where: { id: payout.id, status: payout.status, attempts: payout.attempts },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, payoutAccountId: account.id, failureReason: null },
    });
    if (claimed.count === 0) return { acted: false };

    const amountPaise = Number(payout.amountPaise);
    let reference: string;
    try {
      ({ reference } = await mockDriver.transfer({ payoutId: payout.id, amountPaise, account }));
    } catch (error) {
      const reason =
        error instanceof PayoutTransferError ? error.message : 'The transfer could not be completed. It will be retried.';
      await this.prisma.payout.update({ where: { id: payout.id }, data: { status: 'FAILED', failureReason: reason } });
      this.logger.warn(`Payout ${payout.id} failed (attempt ${payout.attempts + 1}): ${reason}`);
      await this.notifySafely(payout.workerId, {
        event: 'PAYOUT_FAILED',
        taskId: payout.taskId,
        taskTitle: payout.task.title,
        payoutPaise: amountPaise,
        reason,
      });
      return { acted: true };
    }

    // Only the earnings payout finishes the task; an item reimbursement is
    // sent at the handover, before the requester has even reviewed it.
    const markPaid =
      payout.kind === 'EARNINGS' && checkTransition(payout.task.status, 'PAYMENT_RELEASED', 'SYSTEM').allowed;
    await this.prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payout.id },
        data: { status: 'PROCESSED', processedAt: new Date(), gatewayTransferId: reference },
      });
      await this.ledger.recordPayout(
        { taskId: payout.taskId, payoutId: payout.id, amountPaise, kind: payout.kind },
        tx,
      );
      // COMPLETED → PAYMENT_RELEASED is the state machine's last step: the
      // money has actually reached the worker, not just been approved.
      if (markPaid) {
        const moved = await tx.task.updateMany({
          where: { id: payout.taskId, status: 'COMPLETED' },
          data: { status: 'PAYMENT_RELEASED' },
        });
        if (moved.count > 0) {
          await tx.taskStatusHistory.create({
            data: {
              taskId: payout.taskId,
              fromStatus: 'COMPLETED',
              toStatus: 'PAYMENT_RELEASED',
              actorRole: 'SYSTEM',
              reason: `Paid to the worker (reference ${reference}).`,
            },
          });
        }
      }
    });
    if (markPaid) this.publisher.toTask(payout.taskId, 'task:status', { taskId: payout.taskId, status: 'PAYMENT_RELEASED' });

    await this.notifySafely(payout.workerId, {
      event: 'PAYMENT_RELEASED',
      taskId: payout.taskId,
      taskTitle: payout.task.title,
      payoutPaise: amountPaise,
    });
    this.logger.log(`Payout ${payout.id} sent: ₹${amountPaise / 100} (${reference}).`);
    return { acted: true };
  }

  /**
   * The guarantee behind sendOwed: owed payouts for workers who now have a
   * verified account, failed ones whose backoff has passed, and transfers
   * stuck in PROCESSING (a crash between claim and answer). Run by the
   * worker process every minute.
   */
  async sweep(now = new Date()): Promise<number> {
    if (payoutProvider() === 'none') return 0;
    const env = loadEnv();

    // A PROCESSING payout with no answer is retried, never assumed paid. The
    // mock driver answers at once; a real gateway's status check belongs here.
    await this.prisma.payout.updateMany({
      where: { status: 'PROCESSING', updatedAt: { lt: new Date(now.getTime() - STUCK_PROCESSING_MS) } },
      data: { status: 'FAILED', failureReason: 'No answer from the payout partner. It will be retried.' },
    });

    const candidates = await this.prisma.payout.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        attempts: { lt: env.PAYOUT_MAX_ATTEMPTS },
        worker: {
          verificationLevel: { gte: 2 },
          payoutAccounts: { some: { removedAt: null, isVerified: true, isDefault: true } },
        },
      },
      select: { id: true, status: true, attempts: true, updatedAt: true },
      take: 100,
    });

    let sent = 0;
    for (const payout of candidates) {
      if (payout.status === 'FAILED') {
        const wait = RETRY_BACKOFF_MS[Math.min(payout.attempts - 1, RETRY_BACKOFF_MS.length - 1)] ?? 0;
        if (now.getTime() - payout.updatedAt.getTime() < wait) continue;
      }
      if ((await this.process(payout.id)).acted) sent += 1;
    }
    return sent;
  }

  async summary(workerId: string): Promise<PayoutSummary> {
    const [groups, account, worker] = await Promise.all([
      this.prisma.payout.groupBy({
        by: ['status'],
        where: { workerId },
        _sum: { amountPaise: true, reimbursementPaise: true },
        _count: { _all: true },
      }),
      this.payoutAccount(workerId),
      this.prisma.user.findUniqueOrThrow({ where: { id: workerId }, select: { verificationLevel: true } }),
    ]);

    const sum = (statuses: string[]) =>
      groups.filter((g) => statuses.includes(g.status)).reduce((total, g) => total + Number(g._sum.amountPaise ?? 0), 0);
    const live = groups.filter((g) => g.status !== 'REVERSED');
    const total = live.reduce((t, g) => t + Number(g._sum.amountPaise ?? 0), 0);
    const reimbursed = live.reduce((t, g) => t + Number(g._sum.reimbursementPaise ?? 0), 0);

    return {
      provider: payoutProvider(),
      availablePaise: sum(['PENDING', 'FAILED']),
      processingPaise: sum(['PROCESSING']),
      paidPaise: sum(['PROCESSED']),
      earnedPaise: total - reimbursed,
      reimbursedPaise: reimbursed,
      failedCount: groups.find((g) => g.status === 'FAILED')?._count._all ?? 0,
      identityVerified: worker.verificationLevel >= 2,
      account: account
        ? {
            id: account.id,
            type: account.type,
            label: account.type === 'BANK' ? `Bank account ••${(account.accountNumberMasked ?? '').slice(-4)}` : (account.upiVpa ?? 'UPI'),
          }
        : null,
    };
  }

  /** docs/07: "GET /payouts/mine | worker | Payout history." Newest first, opaque cursor. */
  async listMine(workerId: string, limit: number, cursor?: string) {
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
      include: { task: { select: { title: true } }, payoutAccount: true },
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
        earningsPaise: Number(p.amountPaise) - Number(p.reimbursementPaise),
        reimbursementPaise: Number(p.reimbursementPaise),
        status: p.status,
        failureReason: p.status === 'FAILED' ? p.failureReason : null,
        reference: p.status === 'PROCESSED' ? p.gatewayTransferId : null,
        destination: p.payoutAccount
          ? p.payoutAccount.type === 'BANK'
            ? `••${(p.payoutAccount.accountNumberMasked ?? '').slice(-4)}`
            : p.payoutAccount.upiVpa
          : null,
        processedAt: p.processedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    };
  }

  /**
   * The verified default account payouts go to, if any. Money is sent only
   * to a checked account of a worker whose identity is verified (level 2+):
   * the restriction docs/12 puts on financial features until KYC is done.
   */
  private payoutAccount(workerId: string) {
    return this.prisma.payoutAccount.findFirst({
      where: {
        userId: workerId,
        removedAt: null,
        isVerified: true,
        isDefault: true,
        user: { verificationLevel: { gte: 2 } },
      },
    });
  }

  private async notifySafely(userId: string, payload: Parameters<NotificationService['notify']>[1]): Promise<void> {
    try {
      await this.notifications.notify(userId, payload);
    } catch (error) {
      this.logger.warn(`Payout notification for ${userId} failed: ${String(error)}`);
    }
  }
}
