import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
@Injectable()
export class SweeperService {
  private readonly logger = new Logger(SweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly review: ReviewService,
    private readonly tasks: TasksService,
  ) {}

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runReviewDeadlineSweep();
      void this.runTaskExpirySweep();
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
}
