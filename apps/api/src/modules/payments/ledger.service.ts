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

    const client = tx ?? this.prisma;
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
  }): Promise<void> {
    const entries: Parameters<LedgerService['writeEntries']>[0] = [
      {
        taskId: params.taskId,
        paymentId: params.paymentId,
        account: 'ESCROW',
        entryType: 'RELEASE',
        amountPaise: -params.budgetPaise,
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

    await this.writeEntries(entries);
  }

  /**
   * A dispute resolved as a split: escrow divides between the worker and a
   * refund, with NO platform commission — docs/14-dispute-resolution.md:
   * "The platform normally waives its commission on a split, since a partial
   * failure is partly the platform's matching failure." The two amounts are
   * computed by packages/money's `calculateDisputeSplit`, which is what
   * guarantees they sum back to the held amount.
   *
   *   ESCROW           -(workerPaise + refundPaise)
   *   WORKER_PAYABLE   +workerPaise   (only written if nonzero)
   *   REFUND           +refundPaise   (only written if nonzero)
   */
  async recordDisputeSplit(params: {
    taskId: string;
    paymentId: string;
    workerPaise: number;
    refundPaise: number;
  }): Promise<void> {
    const total = params.workerPaise + params.refundPaise;
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
