import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ReviewInput } from '@onsite/validation';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';

export interface RatingView {
  id: string;
  taskId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

/**
 * Two-way ratings. docs/12-trust-safety.md: "Ratings are two-way. A
 * requester who disputes without cause, cancels repeatedly after assignment,
 * or writes unclear instructions accumulates a record that workers can see."
 *
 * Scope note: docs/12's trust-score mockup ("Rahul S. ⭐ 4.92 · 187 tasks")
 * is worker-facing, and only `WorkerProfile` carries a `ratingAvg`/
 * `ratingCount` aggregate — there is no equivalent requester-side aggregate
 * table in the schema. A worker rating a requester is still recorded (the
 * `Review` row exists and is real dispute evidence), but only updates a
 * running aggregate when the ratee has a `WorkerProfile`. Adding a
 * requester-side trust aggregate is future work, not silently skipped — see
 * TODO.md.
 */
@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async submit(taskId: string, raterId: string, input: ReviewInput): Promise<RatingView> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task not found.');

    const isRequester = task.requesterId === raterId;
    const isWorker = task.assignedWorkerId === raterId;
    if (!isRequester && !isWorker) throw new NotFoundError('Task not found.');

    if (task.status !== 'COMPLETED' && task.status !== 'PAYMENT_RELEASED') {
      throw new BusinessRuleError('You can only rate a task after it is completed.');
    }

    const rateeId = isRequester ? task.assignedWorkerId : task.requesterId;
    if (!rateeId) throw new BusinessRuleError('This task has no other party to rate.');

    let review;
    try {
      review = await this.prisma.review.create({
        data: {
          taskId,
          raterId,
          rateeId,
          direction: isRequester ? 'REQUESTER_TO_WORKER' : 'WORKER_TO_REQUESTER',
          rating: input.rating,
          comment: input.comment,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('You have already rated this task.');
      }
      throw error;
    }

    await this.bumpRateeAggregate(rateeId, input.rating);

    try {
      await this.notifications.notify(rateeId, {
        event: 'RATING_RECEIVED',
        taskId,
        taskTitle: task.title,
        rating: input.rating,
      });
    } catch (error) {
      this.logger.warn(`Notification dispatch failed for rating on task ${taskId}: ${String(error)}`);
    }

    return { id: review.id, taskId, rating: review.rating, comment: review.comment, createdAt: review.createdAt.toISOString() };
  }

  private async bumpRateeAggregate(rateeId: string, rating: number): Promise<void> {
    const profile = await this.prisma.workerProfile.findUnique({ where: { userId: rateeId } });
    if (!profile) return; // See the class comment: no requester-side aggregate exists yet.

    const newCount = profile.ratingCount + 1;
    const newAvg = ((profile.ratingAvg ?? 0) * profile.ratingCount + rating) / newCount;
    await this.prisma.workerProfile.update({
      where: { userId: rateeId },
      data: { ratingAvg: Math.round(newAvg * 100) / 100, ratingCount: newCount },
    });
  }
}
