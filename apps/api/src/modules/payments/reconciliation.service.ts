import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { RazorpayService } from './razorpay.service';
import { REFUND_MAX_ATTEMPTS } from './refunds.service';

export type FindingKind =
  | 'LEDGER_UNBALANCED'
  | 'ESCROW_OVERDRAWN'
  | 'ESCROW_LEFT_AFTER_SETTLEMENT'
  | 'CAPTURE_NOT_BOOKED'
  | 'REFUND_NOT_QUEUED'
  | 'REFUND_STUCK'
  | 'PAYOUT_STUCK'
  | 'GATEWAY_MISMATCH';

export interface Finding {
  kind: FindingKind;
  taskId?: string;
  detail: string;
}

export interface ReconciliationReport {
  ranAt: string;
  findings: Finding[];
  checked: { tasksInLedger: number; gatewayPayments: number };
}

/** A refund the gateway has not settled after this long needs a look. */
const REFUND_STUCK_MS = 2 * 24 * 3_600_000;
/** How far back the gateway comparison looks, and how many payments per run. */
const GATEWAY_WINDOW_MS = 48 * 3_600_000;
const GATEWAY_SAMPLE = 50;

/**
 * Daily-style reconciliation (docs/11, docs/22 #25), run hourly by the
 * worker's sweeper and on demand by admins (GET /admin/reconciliation). It
 * moves no money and changes nothing: it looks for states that should be
 * impossible and reports them, each as an error log line starting
 * "Reconciliation:" for monitoring to alert on.
 *
 * - every task's ledger sums to zero;
 * - no task's escrow is below zero;
 * - a settled payment (released or refunded) leaves nothing in escrow;
 * - every payment marked captured has its capture booked into escrow;
 * - every refund booked in the ledger has gateway refunds queued for it
 *   (refunds booked before the refund outbox existed are not compared);
 * - no refund or payout has given up retrying, or sat unsettled for days;
 * - for recent Razorpay payments, the gateway agrees on the amount captured
 *   and refunded.
 *
 * Not covered: Razorpay's settlement reports (what actually reached the
 * bank account), which need the settlements API and a finance owner.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
  ) {}

  async run(now = new Date()): Promise<ReconciliationReport> {
    const findings: Finding[] = [];

    // 1. Every task's ledger sums to zero.
    const sums = await this.prisma.ledgerEntry.groupBy({
      by: ['taskId'],
      where: { taskId: { not: null } },
      _sum: { amountPaise: true },
    });
    for (const s of sums) {
      const total = Number(s._sum.amountPaise ?? 0);
      if (total !== 0 && s.taskId) findings.push({ kind: 'LEDGER_UNBALANCED', taskId: s.taskId, detail: `Ledger sums to ${total} paise.` });
    }

    // 2–4. Escrow against the payment's state.
    const escrow = await this.prisma.ledgerEntry.groupBy({
      by: ['taskId'],
      where: { account: 'ESCROW', taskId: { not: null } },
      _sum: { amountPaise: true },
    });
    const escrowByTask = new Map(escrow.map((e) => [e.taskId as string, Number(e._sum.amountPaise ?? 0)]));
    for (const [taskId, held] of escrowByTask) {
      if (held < 0) findings.push({ kind: 'ESCROW_OVERDRAWN', taskId, detail: `Escrow is ${held} paise.` });
    }

    const settled = await this.prisma.payment.findMany({
      where: { status: { in: ['RELEASED', 'REFUNDED'] } },
      select: { taskId: true, status: true },
    });
    for (const p of settled) {
      const held = escrowByTask.get(p.taskId) ?? 0;
      if (held > 0) {
        findings.push({ kind: 'ESCROW_LEFT_AFTER_SETTLEMENT', taskId: p.taskId, detail: `Payment is ${p.status} but escrow still holds ${held} paise.` });
      }
    }

    const booked = await this.prisma.ledgerEntry.groupBy({
      by: ['taskId'],
      where: { account: 'ESCROW', entryType: 'CAPTURE', amountPaise: { gt: 0 }, taskId: { not: null } },
      _count: { _all: true },
    });
    const bookedTasks = new Set(booked.map((b) => b.taskId));
    const captured = await this.prisma.payment.findMany({
      where: { status: { in: ['CAPTURED', 'RELEASED', 'REFUNDED'] } },
      select: { taskId: true, status: true },
    });
    for (const p of captured) {
      if (!bookedTasks.has(p.taskId)) {
        findings.push({ kind: 'CAPTURE_NOT_BOOKED', taskId: p.taskId, detail: `Payment is ${p.status} with no capture in escrow.` });
      }
    }

    // 5. Refunds booked in the ledger have gateway refunds queued.
    const firstRefund = await this.prisma.refund.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    if (firstRefund) {
      const ledgerRefunds = await this.prisma.ledgerEntry.groupBy({
        by: ['taskId'],
        where: { account: 'REFUND', amountPaise: { gt: 0 }, taskId: { not: null }, createdAt: { gte: firstRefund.createdAt } },
        _sum: { amountPaise: true },
      });
      const queued = await this.prisma.refund.groupBy({ by: ['taskId'], _sum: { amountPaise: true } });
      const queuedByTask = new Map(queued.map((q) => [q.taskId, Number(q._sum.amountPaise ?? 0)]));
      for (const l of ledgerRefunds) {
        const booked = Number(l._sum.amountPaise ?? 0);
        const sent = queuedByTask.get(l.taskId as string) ?? 0;
        if (booked !== sent) {
          findings.push({ kind: 'REFUND_NOT_QUEUED', taskId: l.taskId as string, detail: `Ledger refunds ${booked} paise; gateway refunds queued ${sent}.` });
        }
      }
    }

    // 6. Refunds and payouts that gave up, or sit unsettled.
    const stuckRefunds = await this.prisma.refund.findMany({
      where: {
        OR: [
          { status: 'FAILED', attempts: { gte: REFUND_MAX_ATTEMPTS } },
          { status: { in: ['PENDING', 'PROCESSING'] }, createdAt: { lt: new Date(now.getTime() - REFUND_STUCK_MS) } },
        ],
      },
      select: { id: true, taskId: true, status: true, amountPaise: true, failureReason: true },
      take: 100,
    });
    for (const r of stuckRefunds) {
      findings.push({
        kind: 'REFUND_STUCK',
        taskId: r.taskId,
        detail: `Refund ${r.id} of ${Number(r.amountPaise)} paise is ${r.status}${r.failureReason ? `: ${r.failureReason}` : ''}.`,
      });
    }
    const stuckPayouts = await this.prisma.payout.findMany({
      where: { status: 'FAILED', attempts: { gte: loadEnv().PAYOUT_MAX_ATTEMPTS } },
      select: { id: true, taskId: true, amountPaise: true, failureReason: true },
      take: 100,
    });
    for (const p of stuckPayouts) {
      findings.push({
        kind: 'PAYOUT_STUCK',
        taskId: p.taskId,
        detail: `Payout ${p.id} of ${Number(p.amountPaise)} paise gave up${p.failureReason ? `: ${p.failureReason}` : ''}.`,
      });
    }

    // 7. The gateway agrees with us on recent payments.
    const gatewayChecked = await this.compareWithGateway(now, findings);

    for (const f of findings) {
      this.logger.error(`Reconciliation: ${f.kind}${f.taskId ? ` task ${f.taskId}` : ''}: ${f.detail}`);
    }
    if (findings.length === 0) this.logger.log(`Reconciliation: clean (${sums.length} tasks, ${gatewayChecked} gateway payments checked).`);

    return { ranAt: now.toISOString(), findings, checked: { tasksInLedger: sums.length, gatewayPayments: gatewayChecked } };
  }

  private async compareWithGateway(now: Date, findings: Finding[]): Promise<number> {
    const env = loadEnv();
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return 0;

    const payments = await this.prisma.payment.findMany({
      where: {
        gateway: 'RAZORPAY',
        gatewayPaymentId: { not: null },
        status: { in: ['CAPTURED', 'RELEASED', 'REFUNDED'] },
        capturedAt: { gte: new Date(now.getTime() - GATEWAY_WINDOW_MS) },
      },
      select: { id: true, taskId: true, gatewayPaymentId: true, amountPaise: true },
      orderBy: { capturedAt: 'desc' },
      take: GATEWAY_SAMPLE,
    });

    let checked = 0;
    for (const p of payments) {
      if (!p.gatewayPaymentId) continue;
      try {
        const g = await this.razorpay.fetchPayment(p.gatewayPaymentId);
        checked += 1;
        if (g.status !== 'captured' && g.status !== 'refunded') {
          findings.push({ kind: 'GATEWAY_MISMATCH', taskId: p.taskId, detail: `We hold it captured; Razorpay says ${g.status}.` });
          continue;
        }
        if (g.amount !== Number(p.amountPaise)) {
          findings.push({ kind: 'GATEWAY_MISMATCH', taskId: p.taskId, detail: `Captured ${Number(p.amountPaise)} paise here, ${g.amount} at Razorpay.` });
        }
        const processed = await this.prisma.refund.aggregate({
          where: { paymentId: p.id, status: 'PROCESSED' },
          _sum: { amountPaise: true },
        });
        const ours = Number(processed._sum.amountPaise ?? 0);
        // Razorpay may count a refund as done before its webhook reaches
        // us, so only "they refunded less than we think" is a finding.
        if ((g.amount_refunded ?? 0) < ours) {
          findings.push({ kind: 'GATEWAY_MISMATCH', taskId: p.taskId, detail: `Refunds processed here ${ours} paise, at Razorpay ${g.amount_refunded ?? 0}.` });
        }
      } catch (error) {
        this.logger.warn(`Reconciliation could not check payment ${p.gatewayPaymentId} with Razorpay: ${String(error)}`);
      }
    }
    return checked;
  }
}
