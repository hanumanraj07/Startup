import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DisputesService } from '../disputes/disputes.service';
import { OffersService } from '../matching/offers.service';
import { PaymentsService } from '../payments/payments.service';
import { PayoutsService } from '../payments/payouts.service';
import { RefundsService } from '../payments/refunds.service';
import { ReviewService } from './review.service';
import { TasksService } from './tasks.service';

/**
 * The guarantee behind auto-approval AND task expiry, and deliberately the
 * simplest piece of infrastructure in this codebase: a plain interval timer
 * polling Postgres. No Redis, no BullMQ, no external dependency of any kind.
 *
 * That absence of dependencies is the entire point. The delayed job in
 * auto-approve.queue.ts is the fast path, and it depends on Redis. If Redis
 * is down, degraded, or has simply dropped a job — which does happen — a
 * queue-only design means a worker silently never gets paid, and nobody
 * finds out until they complain. This sweeper reads the same
 * `review_deadline_at` column the queue path reads, using the
 * tasks_review_deadline_ix partial index built in the initial migration, and
 * it does not care whether the queue exists at all.
 *
 * Task expiry is swept the same way, reading `deadline_at` via the
 * tasks_expiry_ix partial index — there is no BullMQ fast path for expiry at
 * all (see TasksService.expireIfDue's comment on why), so this sweep is
 * expiry's only mechanism, not a backstop for one.
 *
 * Both `autoApprove` and `expireIfDue` are idempotent, so this can run on
 * every worker-process replica without coordination: whichever instance's
 * tick or job wins for a given task, every other attempt is a harmless
 * no-op. See docs/05-system-architecture.md and ai/memory.md.
 */
/** How long a finished task must sit untouched before its held payment counts as stranded. */
const STRANDED_AFTER_MS = 2 * 60 * 1000;

@Injectable()
export class SweeperService {
  private readonly logger = new Logger(SweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly review: ReviewService,
    private readonly tasks: TasksService,
    private readonly offers: OffersService,
    private readonly payouts: PayoutsService,
    private readonly refunds: RefundsService,
    private readonly disputes: DisputesService,
    private readonly payments: PaymentsService,
  ) {}

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runReviewDeadlineSweep();
      void this.runTaskExpirySweep();
      void this.runOfferExpirySweep();
      void this.runPayoutSweep();
      void this.runStrandedMoneySweep();
      void this.runRefundSweep();
      void this.runPaymentReconcileSweep();
    }, intervalMs);
    // Never let a scheduled tick keep the process alive on its own if
    // everything else has shut down.
    this.timer.unref?.();
    this.logger.log(`Review-deadline and task-expiry sweeper started, running every ${intervalMs}ms.`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One sweep: every SUBMITTED or UNDER_REVIEW task whose review deadline has
   * passed gets auto-approved. Each task is handled independently — one
   * failure is logged and does not stop the rest of the batch.
   */
  async runReviewDeadlineSweep(): Promise<{ processed: number; acted: number }> {
    const due = await this.prisma.task.findMany({
      where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] }, reviewDeadlineAt: { lte: new Date() } },
      select: { id: true },
    });

    let acted = 0;
    for (const { id } of due) {
      try {
        const result = await this.review.autoApprove(id);
        if (result.acted) {
          acted += 1;
          this.logger.log(`Auto-approved task ${id} via the sweeper (guarantee path).`);
        }
      } catch (error) {
        this.logger.error(`Sweeper failed to auto-approve task ${id}: ${String(error)}`);
      }
    }

    return { processed: due.length, acted };
  }

  /**
   * Closes task requests whose 90-second window has passed. The tier pass
   * closes its own task's requests before sending the next wave; this
   * catches the last wave, and any request whose tier job Redis lost.
   */
  async runOfferExpirySweep(): Promise<number> {
    try {
      return await this.offers.expireOverdue();
    } catch (error) {
      this.logger.error(`Sweeper failed to expire offers: ${String(error)}`);
      return 0;
    }
  }

  /**
   * Sends payouts that are owed: to workers who have just verified an
   * account, failed ones whose retry backoff has passed, and any transfer
   * stuck without an answer. sendOwed at release is the fast path.
   */
  async runPayoutSweep(): Promise<number> {
    try {
      return await this.payouts.sweep();
    } catch (error) {
      this.logger.error(`Sweeper failed to send payouts: ${String(error)}`);
      return 0;
    }
  }

  /**
   * One sweep: every PUBLISHED or MATCHING task with no assigned worker whose
   * deadline has passed is expired and refunded. Each task is handled
   * independently — one failure is logged and does not stop the rest of the
   * batch, matching runReviewDeadlineSweep's pattern.
   */
  async runTaskExpirySweep(): Promise<{ processed: number; acted: number }> {
    const due = await this.prisma.task.findMany({
      where: {
        status: { in: ['PUBLISHED', 'MATCHING'] },
        assignedWorkerId: null,
        deadlineAt: { lte: new Date() },
      },
      select: { id: true },
    });

    let acted = 0;
    for (const { id } of due) {
      try {
        const result = await this.tasks.expireIfDue(id);
        if (result.acted) {
          acted += 1;
          this.logger.log(`Expired task ${id} via the sweeper (no acceptance before the deadline).`);
        }
      } catch (error) {
        this.logger.error(`Sweeper failed to expire task ${id}: ${String(error)}`);
      }
    }

    return { processed: due.length, acted };
  }

  /**
   * Asks the gateway about orders still unpaid after a few minutes, for the
   * webhook that never arrived (docs/22, #12).
   */
  async runPaymentReconcileSweep(): Promise<number> {
    try {
      return await this.payments.reconcilePending();
    } catch (error) {
      this.logger.error(`Sweeper failed to reconcile pending payments: ${String(error)}`);
      return 0;
    }
  }

  /**
   * Sends the refunds the ledger has queued to the gateway, retries failed
   * ones, and checks on any the gateway has not settled (docs/22, #4).
   */
  async runRefundSweep(): Promise<number> {
    try {
      return await this.refunds.sweep();
    } catch (error) {
      this.logger.error(`Sweeper failed to send refunds: ${String(error)}`);
      return 0;
    }
  }

  /**
   * Money left behind a finished status: a task EXPIRED or CANCELLED whose
   * payment was never refunded, or COMPLETED whose payment was never
   * released. Each of those flows writes the status first and moves money
   * after, so a crash between the two strands the payment, and nothing else
   * revisits a task once it has left the statuses the other sweeps read.
   * Only tasks untouched for STRANDED_AFTER_MS are considered, so this never
   * races the live path that is about to move the money itself.
   *
   * A task finished by a dispute decision is finished the way the admin
   * decided (a split, a refund), never by a plain release or refund.
   */
  async runStrandedMoneySweep(): Promise<{ processed: number; acted: number }> {
    let due: { id: string; status: string; disputes: { id: string }[] }[];
    try {
      due = await this.prisma.task.findMany({
        where: {
          status: { in: ['EXPIRED', 'CANCELLED', 'COMPLETED'] },
          payment: { status: 'CAPTURED' },
          updatedAt: { lte: new Date(Date.now() - STRANDED_AFTER_MS) },
        },
        select: {
          id: true,
          status: true,
          disputes: { where: { status: 'RESOLVED' }, select: { id: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
        take: 50,
      });
    } catch (error) {
      this.logger.error(`Sweeper failed to look for stranded payments: ${String(error)}`);
      return { processed: 0, acted: 0 };
    }

    let acted = 0;
    for (const { id, status, disputes } of due) {
      try {
        const resolved = disputes[0];
        const result = resolved
          ? await this.disputes.settleResolution(resolved.id)
          : status === 'COMPLETED'
            ? await this.review.releaseStranded(id)
            : await this.tasks.refundStranded(id);
        if (result.acted) acted += 1;
      } catch (error) {
        this.logger.error(`Sweeper failed to repair the stranded payment of task ${id}: ${String(error)}`);
      }
    }

    return { processed: due.length, acted };
  }
}
