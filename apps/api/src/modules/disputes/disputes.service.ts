import { Injectable, Logger } from '@nestjs/common';
import type { CreateDisputeInput, DisputeStatementInput, ResolveDisputeInput } from '@onsite/validation';
import { calculateDisputeSplit } from '@onsite/money';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { AuditService } from '../../common/audit.service';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoApproveQueue } from '../../queue/auto-approve.queue';
import { LedgerService } from '../payments/ledger.service';
import { NotificationService } from '../notifications/notification.service';
import { StorageService } from '../storage/storage.service';
import { assertTransitionAllowed, DISPUTABLE_STATUSES } from '../tasks/transitions';

export interface DisputeView {
  id: string;
  taskId: string;
  raisedById: string;
  reason: string;
  description: string;
  status: string;
  resolution: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  statements: { id: string; userId: string; body: string; attachmentKeys: string[]; createdAt: string }[];
}

/**
 * Disputes: raising one (which must freeze the task immediately and win the
 * race against auto-approval), statements, and admin resolution.
 * docs/14-dispute-resolution.md.
 */
@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly autoApproveQueue: AutoApproveQueue,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Raises a dispute and freezes the task. The freeze is the atomic
   * conditional `updateMany` below, not the pre-check above it — the
   * pre-check only produces a clean error message for the ordinary case
   * (task never was in a disputable state to begin with). If a completion is
   * committing in the same instant, whichever write reaches Postgres first
   * wins; this is the other half of the race described in
   * review.service.ts's completeApproval.
   */
  async raise(taskId: string, userId: string, input: CreateDisputeInput): Promise<DisputeView> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task not found.');

    const isRequester = task.requesterId === userId;
    const isWorker = task.assignedWorkerId === userId;
    if (!isRequester && !isWorker) throw new NotFoundError('Task not found.');

    assertTransitionAllowed(task.status, 'DISPUTED', isRequester ? 'REQUESTER' : 'WORKER');

    const existing = await this.prisma.dispute.findFirst({
      where: { taskId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
    });
    if (existing) throw new ConflictError('A dispute is already open for this task.');

    const frozen = await this.prisma.task.updateMany({
      where: { id: taskId, status: { in: [...DISPUTABLE_STATUSES] } },
      data: { status: 'DISPUTED' },
    });
    if (frozen.count === 0) {
      throw new ConflictError('This task cannot be disputed in its current state.');
    }

    const dispute = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dispute.create({
        data: { taskId, raisedById: userId, reason: input.reason, description: input.description },
      });
      await tx.taskStatusHistory.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: 'DISPUTED',
          actorUserId: userId,
          actorRole: isRequester ? 'REQUESTER' : 'WORKER',
          reason: input.reason,
        },
      });
      return created;
    });

    // Best-effort cleanup: the task's own status no longer being
    // SUBMITTED/UNDER_REVIEW already makes autoApprove() a no-op regardless
    // (see review.service.ts), this just stops a stale job from ticking.
    await this.autoApproveQueue.cancel(taskId);

    await this.notifyPartiesAndAdmins(task, userId, isRequester);

    this.logger.log(`Dispute ${dispute.id} raised on task ${taskId} by ${isRequester ? 'requester' : 'worker'}.`);
    return this.toView(dispute, []);
  }

  async addStatement(disputeId: string, userId: string, input: DisputeStatementInput): Promise<DisputeView> {
    // Called for its authorization side effect: throws if the caller isn't a party to this dispute.
    await this.requirePartyDispute(disputeId, userId);

    await this.prisma.disputeStatement.create({
      data: { disputeId, userId, body: input.body, attachmentKeys: input.attachmentKeys ?? [] },
    });

    return this.getById(disputeId, userId);
  }

  async getById(disputeId: string, userId: string): Promise<DisputeView> {
    const dispute = await this.requirePartyDispute(disputeId, userId);
    const statements = await this.prisma.disputeStatement.findMany({
      where: { disputeId },
      orderBy: { createdAt: 'asc' },
    });
    return this.toView(dispute, statements);
  }

  async listMine(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ data: DisputeView[]; nextCursor: string | null }> {
    const cursorData = cursor ? decodeCursor<{ createdAt: string; id: string }>(cursor) : null;

    const disputes = await this.prisma.dispute.findMany({
      where: {
        task: { OR: [{ requesterId: userId }, { assignedWorkerId: userId }] },
        ...(cursorData && {
          OR: [
            { createdAt: { lt: new Date(cursorData.createdAt) } },
            { createdAt: new Date(cursorData.createdAt), id: { lt: cursorData.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = disputes.length > limit;
    const page = disputes.slice(0, limit);
    const last = page.at(-1);

    return {
      data: page.map((d) => this.toView(d, [])),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    };
  }

  // ─── Admin ───────────────────────────────────────────────────────────

  async listForAdmin(limit: number, cursor?: string) {
    const cursorData = cursor ? decodeCursor<{ createdAt: string; id: string }>(cursor) : null;
    const disputes = await this.prisma.dispute.findMany({
      where: {
        status: { in: ['OPEN', 'UNDER_REVIEW'] },
        ...(cursorData && { createdAt: { lt: new Date(cursorData.createdAt) } }),
      },
      orderBy: { createdAt: 'asc' }, // oldest first — docs/15: "Queue sorted by age"
      take: limit + 1,
      include: { task: { select: { title: true, status: true } } },
    });
    const hasMore = disputes.length > limit;
    const page = disputes.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map((d) => ({
        id: d.id,
        taskId: d.taskId,
        taskTitle: d.task.title,
        reason: d.reason,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
        ageHours: Math.round((Date.now() - d.createdAt.getTime()) / 3_600_000),
      })),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString() }) : null,
    };
  }

  /**
   * The evidence bundle from docs/14: identical for both parties and the
   * admin. Assembled from data the system already records as a matter of
   * course, which is the entire reason most disputes resolve on facts.
   */
  async getEvidenceBundle(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { statements: { orderBy: { createdAt: 'asc' } } },
    });
    if (!dispute) throw new NotFoundError('Dispute not found.');

    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: dispute.taskId },
      include: {
        requester: true,
        assignedWorker: { include: { workerProfile: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        proofs: true,
        messages: { orderBy: { createdAt: 'asc' } },
        arrivalRecords: true,
        payment: true,
      },
    });

    const [requesterDisputeCount, workerDisputeCount] = await Promise.all([
      this.prisma.dispute.count({ where: { task: { requesterId: task.requesterId } } }),
      task.assignedWorkerId
        ? this.prisma.dispute.count({ where: { task: { assignedWorkerId: task.assignedWorkerId } } })
        : Promise.resolve(0),
    ]);

    return {
      dispute: this.toView(dispute, dispute.statements),
      instructions: { title: task.title, description: task.description, proofRequirements: task.proofRequirements },
      chat: task.messages.map((m) => ({
        senderId: m.senderId,
        body: m.redactedBody,
        redactionFlags: m.redactionFlags,
        createdAt: m.createdAt.toISOString(),
      })),
      // Evidence the admin can actually look at, not just metadata about it
      // — docs/14's "evidence bundle" and docs/19's evidence viewer both
      // assume the photo/video itself is reachable, not merely described.
      proofs: await Promise.all(
        task.proofs.map(async (p) => ({
          type: p.type,
          url: p.storageKey ? await this.storage.presignGet(p.storageKey) : null,
          distanceFromTaskMeters: p.distanceFromTaskMeters,
          verificationFlags: p.verificationFlags,
          capturedAt: p.capturedAt?.toISOString() ?? null,
          uploadedAt: p.uploadedAt.toISOString(),
          fieldKey: p.fieldKey,
          fieldValue: p.fieldValue,
          noteBody: p.noteBody,
        })),
      ),
      arrivalRecords: task.arrivalRecords.map((a) => ({
        distanceFromTaskMeters: a.distanceFromTaskMeters,
        isWithinGeofence: a.isWithinGeofence,
        createdAt: a.createdAt.toISOString(),
      })),
      statusHistory: task.statusHistory.map((h) => ({
        toStatus: h.toStatus,
        actorRole: h.actorRole,
        reason: h.reason,
        createdAt: h.createdAt.toISOString(),
      })),
      payment: task.payment
        ? { status: task.payment.status, amountPaise: Number(task.payment.amountPaise) }
        : null,
      parties: {
        requester: {
          displayName: task.requester.displayName,
          verificationLevel: task.requester.verificationLevel,
          priorDisputes: requesterDisputeCount,
        },
        worker: task.assignedWorker
          ? {
              displayName: task.assignedWorker.displayName,
              verificationLevel: task.assignedWorker.verificationLevel,
              ratingAvg: task.assignedWorker.workerProfile?.ratingAvg ?? null,
              completionRate: task.assignedWorker.workerProfile?.completionRate ?? null,
              priorDisputes: workerDisputeCount,
            }
          : null,
      },
    };
  }

  /**
   * Admin resolution: release, refund, or split. Money moves according to
   * docs/14's table — release retains commission (identical accounting to a
   * normal approval), refund takes none, and a split waives it entirely and
   * divides the full held amount by the awarded percentage.
   */
  async resolve(
    disputeId: string,
    adminId: string,
    adminIp: string | undefined,
    input: ResolveDisputeInput,
  ): Promise<DisputeView> {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundError('Dispute not found.');
    if (dispute.status === 'RESOLVED') throw new ConflictError('This dispute has already been resolved.');

    const task = await this.prisma.task.findUniqueOrThrow({ where: { id: dispute.taskId } });
    const payment = await this.prisma.payment.findUnique({ where: { taskId: dispute.taskId } });
    if (!payment || payment.status !== 'CAPTURED') {
      throw new BusinessRuleError('This task has no held payment to resolve the dispute against.');
    }

    const before = { disputeStatus: dispute.status, taskStatus: task.status, paymentStatus: payment.status };

    let splitWorkerPaise: number | null = null;
    let splitRefundPaise: number | null = null;
    // The task's terminal state after a dispute has only two options in the
    // state machine (DISPUTED -> COMPLETED or -> CANCELLED). A split still
    // pays the worker something, so it lands on COMPLETED alongside a full
    // release; only a full refund, where the worker receives nothing, is
    // CANCELLED. Documented here because docs/14 does not name a status for
    // this, only the money outcome.
    let nextTaskStatus: 'COMPLETED' | 'CANCELLED';

    if (input.resolution === 'RELEASE_TO_WORKER') {
      nextTaskStatus = 'COMPLETED';
      await this.ledger.recordRelease({
        taskId: task.id,
        paymentId: payment.id,
        budgetPaise: Number(payment.amountPaise),
        commissionPaise: Number(task.commissionPaise),
        gstPaise: Number(task.gstPaise),
        tcsPaise: Number(task.tcsPaise),
        tdsPaise: Number(task.tdsPaise),
        workerPayoutPaise: Number(task.workerPayoutPaise),
      });
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'RELEASED', releasedAt: new Date() } });
      if (task.assignedWorkerId) await this.bumpWorkerCompletionStats(task.assignedWorkerId);
    } else if (input.resolution === 'REFUND_TO_REQUESTER') {
      nextTaskStatus = 'CANCELLED';
      await this.ledger.recordFullRefund({
        taskId: task.id,
        paymentId: payment.id,
        amountPaise: Number(payment.amountPaise),
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'REFUNDED', refundedAt: new Date(), refundAmountPaise: payment.amountPaise },
      });
    } else {
      if (input.workerSharePercent === undefined) {
        // Unreachable in practice: resolveDisputeSchema's own refine requires
        // workerSharePercent whenever resolution is SPLIT. Checked again here
        // so TypeScript can narrow it to `number` without a non-null
        // assertion, and so a future caller that bypasses validation fails
        // loudly instead of computing a split against `undefined`.
        throw new BusinessRuleError('A split resolution requires workerSharePercent.');
      }
      nextTaskStatus = 'COMPLETED';
      const split = calculateDisputeSplit(Number(payment.amountPaise), input.workerSharePercent);
      splitWorkerPaise = split.workerPaise;
      splitRefundPaise = split.refundPaise;
      await this.ledger.recordDisputeSplit({
        taskId: task.id,
        paymentId: payment.id,
        workerPaise: split.workerPaise,
        refundPaise: split.refundPaise,
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'RELEASED', releasedAt: new Date(), refundAmountPaise: split.refundPaise },
      });
      if (task.assignedWorkerId && split.workerPaise > 0) await this.bumpWorkerCompletionStats(task.assignedWorkerId);
    }

    const [updatedDispute] = await this.prisma.$transaction([
      this.prisma.dispute.update({
        where: { id: disputeId },
        data: {
          status: 'RESOLVED',
          resolution: input.resolution,
          splitWorkerPaise,
          splitRefundPaise,
          resolvedByAdminId: adminId,
          resolutionNotes: input.notes,
          resolvedAt: new Date(),
        },
      }),
      this.prisma.task.update({ where: { id: task.id }, data: { status: nextTaskStatus, completedAt: nextTaskStatus === 'COMPLETED' ? new Date() : undefined, cancelledAt: nextTaskStatus === 'CANCELLED' ? new Date() : undefined } }),
      this.prisma.taskStatusHistory.create({
        data: {
          taskId: task.id,
          fromStatus: 'DISPUTED',
          toStatus: nextTaskStatus,
          actorUserId: adminId,
          actorRole: 'ADMIN',
          reason: input.notes,
        },
      }),
    ]);

    await this.audit.record({
      actorUserId: adminId,
      actorIp: adminIp,
      action: 'DISPUTE_RESOLVE',
      entityType: 'Dispute',
      entityId: disputeId,
      before,
      after: { disputeStatus: 'RESOLVED', taskStatus: nextTaskStatus, resolution: input.resolution },
    });

    const resolvedNotifyPayload = {
      event: 'DISPUTE_RESOLVED' as const,
      taskId: task.id,
      taskTitle: task.title,
      resolution: input.resolution,
      notes: input.notes,
    };
    await Promise.all(
      [task.requesterId, task.assignedWorkerId]
        .filter((id): id is string => Boolean(id))
        .map((id) => this.notifications.notify(id, resolvedNotifyPayload).catch((error) => this.logger.warn(String(error)))),
    );

    this.logger.log(`Dispute ${disputeId} resolved (${input.resolution}) by admin ${adminId}.`);
    return this.toView(updatedDispute, []);
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private async notifyPartiesAndAdmins(
    task: { id: string; title: string; requesterId: string; assignedWorkerId: string | null },
    raisedById: string,
    isRequester: boolean,
  ): Promise<void> {
    const otherPartyId = isRequester ? task.assignedWorkerId : task.requesterId;
    const raiser = await this.prisma.user.findUnique({ where: { id: raisedById }, select: { displayName: true } });
    const payload = {
      event: 'DISPUTE_RAISED' as const,
      taskId: task.id,
      taskTitle: task.title,
      raisedByName: raiser?.displayName ?? 'The other party',
    };

    const recipients: string[] = [];
    if (otherPartyId) recipients.push(otherPartyId);
    const admins = await this.prisma.user.findMany({ where: { platformRole: 'ADMIN' }, select: { id: true } });
    recipients.push(...admins.map((a) => a.id));

    await Promise.all(
      recipients.map((id) => this.notifications.notify(id, payload).catch((error) => this.logger.warn(String(error)))),
    );
  }

  private async requirePartyDispute(disputeId: string, userId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId }, include: { task: true } });
    if (!dispute) throw new NotFoundError('Dispute not found.');
    const isParty = dispute.task.requesterId === userId || dispute.task.assignedWorkerId === userId;
    if (!isParty) throw new ForbiddenError('Not a party to this dispute.');
    return dispute;
  }

  private async bumpWorkerCompletionStats(workerId: string): Promise<void> {
    const profile = await this.prisma.workerProfile.findUnique({ where: { userId: workerId } });
    if (!profile) return;
    const tasksCompleted = profile.tasksCompleted + 1;
    const completionRate =
      profile.tasksAccepted > 0 ? Math.round((tasksCompleted / profile.tasksAccepted) * 1000) / 10 : null;
    await this.prisma.workerProfile.update({ where: { userId: workerId }, data: { tasksCompleted, completionRate } });
  }

  private toView(
    dispute: {
      id: string;
      taskId: string;
      raisedById: string;
      reason: string;
      description: string;
      status: string;
      resolution: string | null;
      resolutionNotes: string | null;
      resolvedAt: Date | null;
      createdAt: Date;
    },
    statements: { id: string; userId: string; body: string; attachmentKeys: string[]; createdAt: Date }[],
  ): DisputeView {
    return {
      id: dispute.id,
      taskId: dispute.taskId,
      raisedById: dispute.raisedById,
      reason: dispute.reason,
      description: dispute.description,
      status: dispute.status,
      resolution: dispute.resolution,
      resolutionNotes: dispute.resolutionNotes,
      resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
      createdAt: dispute.createdAt.toISOString(),
      statements: statements.map((s) => ({
        id: s.id,
        userId: s.userId,
        body: s.body,
        attachmentKeys: s.attachmentKeys,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }
}
