import { Injectable } from '@nestjs/common';
// PrismaClient must be a VALUE import, not `import type`. Nest resolves
// constructor injection from the TypeScript-emitted `design:paramtypes`
// metadata, which only exists for values the compiler can see referenced at
// runtime. A type-only import erases that reference, and injection fails with
// "Nest can't resolve dependencies" even though the code compiles cleanly.
import { PrismaClient } from '@prisma/client';
import type { LedgerAccount, LedgerEntryType, Prisma } from '@prisma/client';

/**
 * THE ONLY PLACE MONEY MOVEMENT IS EVER WRITTEN. See ai/project-context.md.
 *
 * Every entry is part of a balanced group: the amounts passed to
 * `writeEntries` in one call must sum to zero. This is enforced here rather
 * than trusted at each call site, so a bug elsewhere in the codebase cannot
 * silently produce an unbalanced task.
 *
 * Scope note: this phase implements capture only — the entries written when a
 * requester's payment is captured and held in escrow. Release, refund, payout
 * and split are Phase 6 work, built against the same writer and the same
 * balancing rule.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Writes a balanced group of entries in one transaction (or as part of an
   * existing one, via `tx`). Throws before writing anything if the group does
   * not sum to zero — an unbalanced entry never reaches the database.
   *
   * Money credited to REFUND is owed back to the requester, and the gateway
   * has to send it: in the same transaction a refund row is queued for it
   * (an outbox), which RefundsService sends. A refund can therefore never be
   * booked without one, from any caller (docs/22, #4: refunds used to be
   * bookkeeping only).
   */
  async writeEntries(
    entries: {
      taskId?: string;
      paymentId?: string;
      payoutId?: string;
      account: LedgerAccount;
      entryType: LedgerEntryType;
      amountPaise: number;
      description: string;
    }[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const sum = entries.reduce((total, e) => total + e.amountPaise, 0);
    if (sum !== 0) {
      throw new Error(
        `Ledger entries do not balance: sum is ${sum} paise, expected 0. This is a defect, never a valid write.`,
      );
    }

    const refundPaise = entries
      .filter((e) => e.account === 'REFUND' && e.amountPaise > 0)
      .reduce((total, e) => total + e.amountPaise, 0);
    const refundTaskId = entries.find((e) => e.account === 'REFUND')?.taskId;
    if (refundPaise > 0 && !refundTaskId) {
      throw new Error('A refund entry must name its task, so the gateway refund can be queued. This is a defect.');
    }

    const write = async (client: Prisma.TransactionClient) => {
      await client.ledgerEntry.createMany({
        data: entries.map((e) => ({
          taskId: e.taskId,
          paymentId: e.paymentId,
          payoutId: e.payoutId,
          account: e.account,
          entryType: e.entryType,
          amountPaise: BigInt(e.amountPaise),
          description: e.description,
        })),
      });
      if (refundPaise > 0 && refundTaskId) await this.queueRefunds(client, refundTaskId, refundPaise);
    };

    if (tx) await write(tx);
    else if (refundPaise > 0) await this.prisma.$transaction(write);
    else await write(this.prisma);
  }

  /**
   * Splits a refund across the captured payments it can go back to, since
   * the gateway refunds each payment separately and never more than it
   * captured: the task's own payment first, then item top-ups, oldest first.
   * What each has already had refunded is read from earlier refund rows.
   */
  private async queueRefunds(client: Prisma.TransactionClient, taskId: string, amountPaise: number): Promise<void> {
    const [payment, topUps, earlier] = await Promise.all([
      client.payment.findUnique({
        where: { taskId },
        select: { id: true, gateway: true, gatewayPaymentId: true, amountPaise: true },
      }),
      client.itemPurchase.findMany({
        where: { taskId, topUpCapturedAt: { not: null }, topUpPaise: { gt: 0 } },
        select: { id: true, topUpGateway: true, topUpGatewayPaymentId: true, topUpPaise: true },
        orderBy: { createdAt: 'asc' },
      }),
      client.refund.findMany({ where: { taskId }, select: { paymentId: true, itemPurchaseId: true, amountPaise: true } }),
    ]);
    if (!payment) throw new Error(`Task ${taskId} has no payment to refund against. This is a defect.`);

    const refunded = (key: { paymentId?: string; itemPurchaseId?: string }) =>
      earlier
        .filter((r) => (key.paymentId ? r.paymentId === key.paymentId : r.itemPurchaseId === key.itemPurchaseId))
        .reduce((total, r) => total + Number(r.amountPaise), 0);

    const sources = [
      {
        paymentId: payment.id,
        gateway: payment.gateway,
        gatewayPaymentId: payment.gatewayPaymentId,
        capacity: Number(payment.amountPaise) - refunded({ paymentId: payment.id }),
      },
      ...topUps.map((p) => ({
        itemPurchaseId: p.id,
        gateway: p.topUpGateway ?? payment.gateway,
        gatewayPaymentId: p.topUpGatewayPaymentId,
        capacity: Number(p.topUpPaise) - refunded({ itemPurchaseId: p.id }),
      })),
    ];

    let left = amountPaise;
    const rows: Prisma.RefundCreateManyInput[] = [];
    for (const source of sources) {
      if (left === 0) break;
      const part = Math.min(left, source.capacity);
      if (part <= 0) continue;
      rows.push({
        taskId,
        paymentId: 'paymentId' in source ? source.paymentId : undefined,
        itemPurchaseId: 'itemPurchaseId' in source ? source.itemPurchaseId : undefined,
        gateway: source.gateway,
        gatewayPaymentId: source.gatewayPaymentId,
        amountPaise: BigInt(part),
      });
      left -= part;
    }
    if (left > 0) {
      throw new Error(`Task ${taskId}: refund of ${amountPaise} paise exceeds what its payments captured. This is a defect.`);
    }
    await client.refund.createMany({ data: rows });
  }

  /**
   * Capture: the requester's funds move into escrow, held against the
   * platform, before the task is ever published.
   *
   *   REQUESTER_FUNDS  -budget
   *   ESCROW           +budget
   */
  async recordCapture(params: {
    taskId: string;
    paymentId: string;
    amountPaise: number;
  }): Promise<void> {
    await this.writeEntries([
      {
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'REQUESTER_FUNDS',
        entryType: 'CAPTURE',
        amountPaise: -params.amountPaise,
        description: 'Requester funds captured for task',
      },
      {
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'ESCROW',
        entryType: 'CAPTURE',
        amountPaise: params.amountPaise,
        description: 'Funds held in escrow pending task completion',
      },
    ]);
  }

  /**
   * Full refund: funds held in escrow return to the requester. Used for
   * pre-assignment cancellation and expiry, where the entire amount is
   * returned and no commission is ever taken.
   *
   *   ESCROW  -amount
   *   REFUND  +amount
   *
   * Partial refunds (post-assignment cancellation, split dispute
   * resolutions) are Phase 6 work, pending the compensation-rate business
   * decision recorded in ai/memory.md.
   */
  /**
   * Release on approval: escrow is distributed to the platform's commission
   * (plus any statutory deductions, zero by default pending accountant
   * confirmation — see docs/02-business-model.md) and the worker's payable
   * balance.
   *
   *   ESCROW              -budget
   *   PLATFORM_COMMISSION +commission
   *   GST_PAYABLE         +gst          (only written if nonzero)
   *   TCS_PAYABLE         +tcs          (only written if nonzero)
   *   TDS_PAYABLE         +tds          (only written if nonzero)
   *   WORKER_PAYABLE      +workerPayout
   *   REFUND              +itemRefund   (only if nonzero: unspent item money)
   *
   * `budgetPaise` is the task payment only. Commission is calculated on it
   * alone. Item money the requester approved has already left escrow by now
   * (recordItemSpend), so `itemRefundPaise` is whatever item money is still
   * held: the caller reads it from escrowBalance, never from a reported cost.
   *
   * This credits WORKER_PAYABLE; it does not transfer money to a bank
   * account or UPI handle. That transfer, and the payout job that performs
   * it, is Phase 6 proper — this is the internal accounting the transfer will
   * read from.
   */
  async recordRelease(params: {
    taskId: string;
    paymentId: string;
    budgetPaise: number;
    commissionPaise: number;
    gstPaise: number;
    tcsPaise: number;
    tdsPaise: number;
    workerPayoutPaise: number;
    itemRefundPaise?: number;
  }, tx?: Prisma.TransactionClient): Promise<void> {
    const entries: Parameters<LedgerService['writeEntries']>[0] = [
      {
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'ESCROW',
        entryType: 'RELEASE',
        amountPaise: -(params.budgetPaise + (params.itemRefundPaise ?? 0)),
        description: 'Escrow released on task approval',
      },
      {
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'PLATFORM_COMMISSION',
        entryType: 'COMMISSION',
        amountPaise: params.commissionPaise,
        description: 'Platform commission',
      },
      {
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'WORKER_PAYABLE',
        entryType: 'RELEASE',
        amountPaise: params.workerPayoutPaise,
        description: 'Worker payout, pending transfer',
      },
    ];

    if (params.gstPaise > 0) {
      entries.push({
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'GST_PAYABLE',
        entryType: 'TAX',
        amountPaise: params.gstPaise,
        description: 'GST on commission',
      });
    }
    if (params.tcsPaise > 0) {
      entries.push({
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'TCS_PAYABLE',
        entryType: 'TAX',
        amountPaise: params.tcsPaise,
        description: 'Tax collected at source',
      });
    }
    if (params.tdsPaise > 0) {
      entries.push({
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'TDS_PAYABLE',
        entryType: 'TAX',
        amountPaise: params.tdsPaise,
        description: 'Tax deducted at source',
      });
    }
    this.pushItemRefund(entries, params);

    await this.writeEntries(entries, tx);
  }

  /** Unspent item money going back to the requester, written only when nonzero. */
  private pushItemRefund(
    entries: Parameters<LedgerService['writeEntries']>[0],
    params: { taskId: string; paymentId: string; itemRefundPaise?: number },
  ): void {
    if (params.itemRefundPaise) {
      entries.push({
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'REFUND',
        entryType: 'REFUND',
        amountPaise: params.itemRefundPaise,
        description: 'Unspent item money refunded to requester',
      });
    }
  }

  /**
   * What escrow still holds for a task: everything captured (the payment and
   * any item top-ups) less everything released, refunded or spent on the item.
   */
  async escrowBalance(taskId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.ledgerEntry.aggregate({
      where: { taskId, account: 'ESCROW' },
      _sum: { amountPaise: true },
    });
    return Number(result._sum.amountPaise ?? 0);
  }

  /**
   * An item top-up captured: the requester approved a bill above what was
   * left of the item budget and paid the difference, held like the rest.
   *
   *   REQUESTER_FUNDS  -topUp
   *   ESCROW           +topUp
   */
  async recordTopUpCapture(
    params: { taskId: string; amountPaise: number },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.writeEntries(
      [
        {
          taskId: params.taskId,
          account: 'REQUESTER_FUNDS',
          entryType: 'CAPTURE',
          amountPaise: -params.amountPaise,
          description: 'Requester top-up captured for an approved item bill',
        },
        {
          taskId: params.taskId,
          account: 'ESCROW',
          entryType: 'CAPTURE',
          amountPaise: params.amountPaise,
          description: 'Item top-up held in escrow',
        },
      ],
      tx,
    );
  }

  /**
   * The approved item money leaves escrow. Never commissioned, never income.
   *
   *   SHOP  (the platform paid the shop's UPI ID):
   *     ESCROW             -amount
   *     ITEM_PASS_THROUGH  +amount
   *   CASH  (the worker paid cash; the handover code was entered):
   *     ESCROW             -amount
   *     ITEM_REIMBURSABLE  +amount   (cleared by the reimbursement payout)
   */
  async recordItemSpend(
    params: { taskId: string; amountPaise: number; route: 'SHOP' | 'CASH' },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.writeEntries(
      [
        {
          taskId: params.taskId,
          account: 'ESCROW',
          entryType: 'RELEASE',
          amountPaise: -params.amountPaise,
          description: 'Approved item bill paid out of escrow',
        },
        params.route === 'SHOP'
          ? {
              taskId: params.taskId,
              account: 'ITEM_PASS_THROUGH',
              entryType: 'PAYOUT',
              amountPaise: params.amountPaise,
              description: 'Paid to the shop for the item',
            }
          : {
              taskId: params.taskId,
              account: 'ITEM_REIMBURSABLE',
              entryType: 'RELEASE',
              amountPaise: params.amountPaise,
              description: 'Cash the worker paid for the item, owed back to them',
            },
      ],
      tx,
    );
  }

  /**
   * Payout processed: what the worker was owed leaves the platform for their
   * bank account or UPI handle.
   *
   *   EARNINGS:
   *     WORKER_PAYABLE     -amount
   *     WORKER_SETTLED     +amount
   *   ITEM_REIMBURSEMENT (repaying cash the worker paid at the shop):
   *     ITEM_REIMBURSABLE  -amount
   *     ITEM_PASS_THROUGH  +amount
   *
   * An EARNINGS payout from before P6 may include a P3 reimbursement; that was
   * credited to WORKER_PAYABLE then, so it is settled from there, whole.
   */
  async recordPayout(
    params: { taskId: string; payoutId: string; amountPaise: number; kind?: 'EARNINGS' | 'ITEM_REIMBURSEMENT' },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const item = params.kind === 'ITEM_REIMBURSEMENT';
    await this.writeEntries(
      [
        {
          taskId: params.taskId,
          payoutId: params.payoutId,
          account: item ? 'ITEM_REIMBURSABLE' : 'WORKER_PAYABLE',
          entryType: 'PAYOUT',
          amountPaise: -params.amountPaise,
          description: item ? 'Item cash repaid to the worker' : 'Paid out to the worker',
        },
        {
          taskId: params.taskId,
          payoutId: params.payoutId,
          account: item ? 'ITEM_PASS_THROUGH' : 'WORKER_SETTLED',
          entryType: 'PAYOUT',
          amountPaise: params.amountPaise,
          description: item ? 'Item money settled to the worker who paid the shop' : 'Settled to the worker payout account',
        },
      ],
      tx,
    );
  }

  /**
   * A dispute resolved as a split: escrow divides between the worker and a
   * refund, with NO platform commission — docs/14-dispute-resolution.md:
   * "The platform normally waives its commission on a split, since a partial
   * failure is partly the platform's matching failure." The two amounts are
   * computed by packages/money's `calculateDisputeSplit`, which is what
   * guarantees they sum back to the held amount.
   *
   *   ESCROW           -(everything held)
   *   WORKER_PAYABLE   +workerPaise   (only written if nonzero)
   *   REFUND           +refundPaise   (only written if nonzero)
   *   REFUND           +itemRefund    (only if nonzero)
   *
   * With an item, the percentage divides the task payment only. An approved
   * bill has already left escrow (recordItemSpend) and is not divided; any
   * item money still held is refunded.
   */
  async recordDisputeSplit(params: {
    taskId: string;
    paymentId: string;
    workerPaise: number;
    refundPaise: number;
    itemRefundPaise?: number;
  }): Promise<void> {
    const total = params.workerPaise + params.refundPaise + (params.itemRefundPaise ?? 0);
    const entries: Parameters<LedgerService['writeEntries']>[0] = [];

    if (total > 0) {
      entries.push({
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'ESCROW',
        entryType: 'RELEASE',
        amountPaise: -total,
        description: 'Escrow divided by dispute resolution',
      });
    }
    if (params.workerPaise > 0) {
      entries.push({
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'WORKER_PAYABLE',
        entryType: 'RELEASE',
        amountPaise: params.workerPaise,
        description: 'Worker share of a split dispute resolution',
      });
    }
    if (params.refundPaise > 0) {
      entries.push({
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'REFUND',
        entryType: 'REFUND',
        amountPaise: params.refundPaise,
        description: 'Requester refund share of a split dispute resolution',
      });
    }
    this.pushItemRefund(entries, params);

    await this.writeEntries(entries);
  }

  async recordFullRefund(params: {
    taskId: string;
    paymentId: string;
    amountPaise: number;
  }): Promise<void> {
    await this.writeEntries([
      {
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'ESCROW',
        entryType: 'REFUND',
        amountPaise: -params.amountPaise,
        description: 'Escrow released back to requester',
      },
      {
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'REFUND',
        entryType: 'REFUND',
        amountPaise: params.amountPaise,
        description: 'Full refund to requester',
      },
    ]);
  }
}
