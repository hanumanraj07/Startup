import { Injectable, Logger } from '@nestjs/common';
import type { Task } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors';
import { AutoApproveQueue } from '../../queue/auto-approve.queue';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { PaymentsService } from '../payments/payments.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { adjustWorkerStats } from '../workers/worker-stats';
import { assertTransitionAllowed, AWAITING_REVIEW, transitionTask } from './transitions';

/**
 * The requester's side of review — approve, releasing payment, or reject,
 * sending the task back for rework — plus system auto-approval, which is the
 * identical completion logic run by an automated actor instead of a person.
 *
 * Sharing `completeApproval` between the two is what makes the guarantee
 * real: a task approved by the sweeper after a missed deadline goes through
 * exactly the same release, ledger, and stats path as one a requester
 * approved by hand. There is no second, weaker code path for the automated
 * case that could drift from the manual one.
 *
 * `completeApproval` races a dispute being raised for the same task, per
 * docs/14-dispute-resolution.md: "A dispute raised one second before the
 * 24-hour auto-approval deadline must win that race." See its own comment
 * for how that race is actually closed — not by checking `hasOpenDispute`
 * beforehand (which reads a snapshot that can go stale between the check and
 * the write), but by making the status write itself conditional.
 */
@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly autoApproveQueue: AutoApproveQueue,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async approve(taskId: string, requesterId: string): Promise<{ status: 'COMPLETED' }> {
    const task = await this.requireOwnedTask(taskId, requesterId);
    const result = await this.completeApproval(task, 'REQUESTER', requesterId);
    if (!result.acted) {
      throw new ConflictError(
        'This task can no longer be approved — its status changed, most likely because a dispute was just raised.',
      );
    }
    await this.autoApproveQueue.cancel(taskId);
    return { status: 'COMPLETED' };
  }

  async reject(taskId: string, requesterId: string, reason: string) {
    const task = await this.requireOwnedTask(taskId, requesterId);

    assertTransitionAllowed(task.status, 'IN_PROGRESS', 'REQUESTER');

    // Same race as completeApproval's: a dispute raised in the instant
    // between the check above and this write must win, not be silently
    // overwritten by a rejection that no longer reflects reality.
    const rejected = await transitionTask(this.prisma, {
      taskId,
      from: task.status,
      alsoFrom: AWAITING_REVIEW,
      to: 'IN_PROGRESS',
      actorRole: 'REQUESTER',
      actorUserId: requesterId,
      reason,
      // Rejection restarts the review clock: it is cleared here and set again
      // only when the worker resubmits. See docs/09-task-lifecycle.md.
      data: { reviewDeadlineAt: null },
    });
    if (!rejected) {
      throw new ConflictError(
        'This task can no longer be rejected — its status changed, most likely because a dispute was just raised.',
      );
    }
    this.realtime.taskStatus(taskId, 'IN_PROGRESS');

    await this.autoApproveQueue.cancel(taskId);

    if (task.assignedWorkerId) {
      try {
        await this.notifications.notify(task.assignedWorkerId, {
          event: 'TASK_REJECTED',
          taskId,
          taskTitle: task.title,
          reason,
        });
      } catch (error) {
        this.logger.warn(`Notification dispatch failed for task ${taskId} rejection: ${String(error)}`);
      }
    }

    return { status: 'IN_PROGRESS' as const };
  }

  /**
   * System auto-approval, called by both the BullMQ job (the fast path) and
   * the sweeper (the guarantee). Idempotent by construction: if the task has
   * already left SUBMITTED/UNDER_REVIEW — a human approved or rejected it
   * first — this is a silent no-op rather than an error, which is exactly
   * what lets the queued job and the sweeper both safely act on the same
   * task without coordinating with each other.
   */
  async autoApprove(taskId: string): Promise<{ acted: boolean }> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return { acted: false };

    if (task.status !== 'SUBMITTED' && task.status !== 'UNDER_REVIEW') {
      return { acted: false };
    }

    return this.completeApproval(task, 'SYSTEM');
  }

  /**
   * The shared core: check the transition is legal, release payment, mark the
   * task COMPLETED, record history, and update the worker's stats.
   *
   * The race against a dispute is closed here, not by reading whether a
   * dispute is open beforehand: `assertTransitionAllowed`'s check below reads
   * `task.status` as it was moments earlier, which can already be stale by
   * the time this runs — exactly the window docs/14 worries about. What
   * actually decides the race is the conditional `updateMany` immediately
   * after it: it only writes COMPLETED if the status is STILL
   * SUBMITTED/UNDER_REVIEW at the instant Postgres executes the write. If a
   * dispute won — flipping the status to DISPUTED first — this affects zero
   * rows, no payment is released, and the caller is told nothing happened
   * rather than money moving on data that was already wrong. Postgres
   * serializes concurrent writes to the same row, so exactly one caller
   * (whichever commits first) can ever see `count > 0` here, which is also
   * what makes two auto-approve attempts on the same task safe without
   * coordinating (see autoApprove's own comment).
   */
  private async completeApproval(
    task: Task,
    actorRole: 'REQUESTER' | 'SYSTEM',
    actorUserId?: string,
  ): Promise<{ acted: boolean }> {
    assertTransitionAllowed(task.status, 'COMPLETED', actorRole, { hasOpenDispute: false });

    const completed = await transitionTask(this.prisma, {
      taskId: task.id,
      from: task.status,
      alsoFrom: AWAITING_REVIEW,
      to: 'COMPLETED',
      actorRole,
      actorUserId,
      reason: actorRole === 'SYSTEM' ? 'Auto-approved after the 24-hour review window.' : undefined,
      data: { completedAt: new Date() },
    });
    if (!completed) {
      this.logger.log(
        `Task ${task.id}: completion skipped — its status changed before this could act, most likely a dispute winning the race.`,
      );
      return { acted: false };
    }
    this.realtime.taskStatus(task.id, 'COMPLETED');

    // Only reached once this call has won the race above — money moves
    // strictly after the status write it depends on is confirmed real.
    await this.payments.release({
      taskId: task.id,
      commissionPaise: Number(task.commissionPaise),
      gstPaise: Number(task.gstPaise),
      tcsPaise: Number(task.tcsPaise),
      tdsPaise: Number(task.tdsPaise),
      workerPayoutPaise: Number(task.workerPayoutPaise),
    });

    await this.afterRelease(task, actorRole);

    this.logger.log(
      `Task ${task.id} completed (${actorRole}). Worker payable: ₹${Number(task.workerPayoutPaise) / 100}.`,
    );

    return { acted: true };
  }

  /**
   * Repair for a task that reached COMPLETED but whose payment is still held:
   * the status write committed and the release after it never ran (docs/22,
   * #2: the broadcast between them threw in the worker process). Called by
   * the sweeper's stranded-money sweep; release claims the payment
   * atomically, so a second attempt is a no-op.
   */
  async releaseStranded(taskId: string): Promise<{ acted: boolean }> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.status !== 'COMPLETED') return { acted: false };

    const released = await this.payments.release({
      taskId: task.id,
      commissionPaise: Number(task.commissionPaise),
      gstPaise: Number(task.gstPaise),
      tcsPaise: Number(task.tcsPaise),
      tdsPaise: Number(task.tdsPaise),
      workerPayoutPaise: Number(task.workerPayoutPaise),
    });
    if (!released) return { acted: false };

    const completion = await this.prisma.taskStatusHistory.findFirst({
      where: { taskId, toStatus: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
    });
    await this.afterRelease(task, completion?.actorRole === 'SYSTEM' ? 'SYSTEM' : 'REQUESTER');
    this.logger.warn(`Task ${taskId} was COMPLETED with its payment still held; released by the repair sweep.`);
    return { acted: true };
  }

  /** Worker stats and the one completion notification, once the payment is released. */
  private async afterRelease(task: Task, actorRole: 'REQUESTER' | 'SYSTEM'): Promise<void> {
    if (task.assignedWorkerId) {
      await this.bumpWorkerCompletionStats(task.assignedWorkerId);

      // One notification, not two: docs/13 lists "Task approved" and
      // "Payment released" as separate events, but in this codebase release
      // happens synchronously inside the same approval — sending both here
      // would violate docs/13's own "one notification per event per
      // recipient" rule by notifying the same worker twice for one action.
      // TASK_APPROVED / TASK_AUTO_APPROVED's copy already states the amount
      // released; PAYMENT_RELEASED is reserved for a genuinely separate
      // release path if one is ever added (e.g. a delayed payout).
      try {
        await this.notifications.notify(task.assignedWorkerId, {
          event: actorRole === 'SYSTEM' ? 'TASK_AUTO_APPROVED' : 'TASK_APPROVED',
          taskId: task.id,
          taskTitle: task.title,
          payoutPaise: Number(task.workerPayoutPaise),
        });
      } catch (error) {
        this.logger.warn(`Notification dispatch failed for task ${task.id} completion: ${String(error)}`);
      }
    }
  }

  private async requireOwnedTask(taskId: string, requesterId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task not found.');
    if (task.requesterId !== requesterId) throw new NotFoundError('Task not found.');
    return task;
  }

  private async bumpWorkerCompletionStats(workerId: string): Promise<void> {
    await adjustWorkerStats(this.prisma, workerId, { completed: 1 });
  }
}
