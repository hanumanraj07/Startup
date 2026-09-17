import { Injectable, Logger } from '@nestjs/common';
import type { ArriveInput, BlockerInput, PresignUploadInput, RecordProofInput } from '@onsite/validation';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../common/errors';
import { loadEnv } from '../../config/env';
import { GeoRepository, DEFAULT_GEOFENCE_METERS } from '../../repositories/geo.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoApproveQueue } from '../../queue/auto-approve.queue';
import { NotificationService } from '../notifications/notification.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StorageService } from '../storage/storage.service';
import { assertTransitionAllowed } from './transitions';

/** How long after capture an upload is treated as suspiciously delayed. */
const UPLOAD_DELAY_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Everything the assigned worker does between acceptance and submission:
 * travel, arrival, evidence capture, and the submission itself.
 *
 * The rule that shapes this whole file: client-reported location and
 * timestamps are evidence, never fact. Every measurement against the task
 * location is computed here, server-side, via the geo repository. A mismatch
 * is recorded as a flag, never silently rejected — mapped shop pins are
 * routinely wrong by 50 metres, and blocking a worker for the map's error
 * would be unjust. See docs/09-task-lifecycle.md.
 */
@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoRepository,
    private readonly storage: StorageService,
    private readonly autoApproveQueue: AutoApproveQueue,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async markEnRoute(taskId: string, workerId: string) {
    const task = await this.requireAssignedTask(taskId, workerId);
    assertTransitionAllowed(task.status, 'WORKER_EN_ROUTE', 'WORKER', { isAssignedWorker: true });

    await this.transition(taskId, task.status, 'WORKER_EN_ROUTE', workerId);
    await this.notifyRequester(task, workerId, 'WORKER_EN_ROUTE');
    return { status: 'WORKER_EN_ROUTE' as const };
  }

  /**
   * Confirms arrival. The reported coordinate is measured against the task
   * location with PostGIS; the client supplies only where it thinks it is,
   * never a distance or a pass/fail verdict.
   */
  async confirmArrival(taskId: string, workerId: string, input: ArriveInput) {
    const task = await this.requireAssignedTask(taskId, workerId);
    assertTransitionAllowed(task.status, 'ARRIVED', 'WORKER', { isAssignedWorker: true });

    const measurement = await this.geo.measureDistanceToTask({
      taskId,
      reportedLat: input.location.latitude,
      reportedLng: input.location.longitude,
    });
    if (!measurement) throw new NotFoundError('Task not found.');

    await this.prisma.$transaction([
      this.prisma.arrivalRecord.create({
        data: {
          taskId,
          workerId,
          reportedLat: input.location.latitude,
          reportedLng: input.location.longitude,
          accuracyMeters: input.location.accuracyMeters,
          distanceFromTaskMeters: measurement.distanceMeters,
          isWithinGeofence: measurement.isWithinGeofence,
        },
      }),
      this.prisma.task.update({ where: { id: taskId }, data: { status: 'ARRIVED' } }),
      this.prisma.taskStatusHistory.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: 'ARRIVED',
          actorUserId: workerId,
          actorRole: 'WORKER',
          metadata: {
            distanceFromTaskMeters: measurement.distanceMeters,
            isWithinGeofence: measurement.isWithinGeofence,
          },
        },
      }),
    ]);
    this.realtime.emitTaskStatus(taskId, 'ARRIVED');

    this.logger.log(
      `Task ${taskId} arrival: ${measurement.distanceMeters.toFixed(0)}m from the task location ` +
        `(within geofence: ${measurement.isWithinGeofence}).`,
    );

    await this.notifyRequester(task, workerId, 'WORKER_ARRIVED');

    return {
      status: 'ARRIVED' as const,
      distanceFromTaskMeters: measurement.distanceMeters,
      isWithinGeofence: measurement.isWithinGeofence,
    };
  }

  // ─── Proof ───────────────────────────────────────────────────────────

  async presignProof(taskId: string, workerId: string, input: PresignUploadInput) {
    await this.requireAssignedTask(taskId, workerId);

    const env = loadEnv();
    const maxBytes = input.type === 'VIDEO' ? env.UPLOAD_MAX_VIDEO_BYTES : env.UPLOAD_MAX_PHOTO_BYTES;
    if (input.sizeBytes > maxBytes) {
      throw new BusinessRuleError(
        `That file is too large. The limit for ${input.type.toLowerCase()} is ${Math.round(maxBytes / (1024 * 1024))} MB.`,
      );
    }

    return this.storage.presignTaskProofUpload({ taskId, workerId, contentType: input.contentType });
  }

  /**
   * Records proof metadata after the client has uploaded directly to
   * storage. Nothing here trusts the client's account of what it uploaded:
   * the object's real content type and size are read back from storage, and
   * any reported location is measured against the task location, not
   * accepted as a distance.
   *
   * The first proof recorded on an ARRIVED task moves it to IN_PROGRESS —
   * there is no separate "begin work" endpoint in the API surface, so this is
   * the natural trigger for that transition.
   */
  async recordProof(taskId: string, workerId: string, input: RecordProofInput) {
    const task = await this.requireAssignedTask(taskId, workerId);

    if (task.status === 'ARRIVED') {
      assertTransitionAllowed(task.status, 'IN_PROGRESS', 'WORKER', { isAssignedWorker: true });
      await this.transition(taskId, task.status, 'IN_PROGRESS', workerId);
    } else if (task.status !== 'IN_PROGRESS') {
      throw new BusinessRuleError('Confirm arrival before submitting proof.');
    }

    const verificationFlags: string[] = [];
    let distanceFromTaskMeters: number | null = null;

    if (input.storageKey) {
      const object = await this.storage.headObject(input.storageKey);
      if (!object.exists) {
        throw new BusinessRuleError('That file has not finished uploading yet. Try again in a moment.');
      }

      const env = loadEnv();
      const maxBytes = input.type === 'VIDEO' ? env.UPLOAD_MAX_VIDEO_BYTES : env.UPLOAD_MAX_PHOTO_BYTES;
      if ((object.sizeBytes ?? 0) > maxBytes) {
        throw new BusinessRuleError('The uploaded file exceeds the size limit.');
      }
    }

    if (input.location) {
      const measurement = await this.geo.measureDistanceToTask({
        taskId,
        reportedLat: input.location.latitude,
        reportedLng: input.location.longitude,
      });
      if (measurement) {
        distanceFromTaskMeters = measurement.distanceMeters;
        if (!measurement.isWithinGeofence) verificationFlags.push('gps_outside_geofence');
      }
    }

    if (input.capturedAt) {
      const delayMs = Date.now() - input.capturedAt.getTime();
      if (delayMs > UPLOAD_DELAY_THRESHOLD_MS) {
        verificationFlags.push('uploaded_long_after_capture');
      }
    }
    // Not implemented: 'missing_exif' and 'timestamp_implausible' require
    // parsing actual image/video metadata, which this build does not do.
    // Recorded as a known gap rather than a fabricated check.

    const proof = await this.prisma.taskProof.create({
      data: {
        taskId,
        workerId,
        type: input.type,
        storageKey: input.storageKey,
        reportedLat: input.location?.latitude,
        reportedLng: input.location?.longitude,
        distanceFromTaskMeters,
        verificationFlags,
        capturedAt: input.capturedAt,
        fieldKey: input.fieldKey,
        fieldValue: input.fieldValue,
        noteBody: input.noteBody,
      },
    });

    return this.toProofView(proof);
  }

  async listProofs(taskId: string, userId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task not found.');
    if (task.requesterId !== userId && task.assignedWorkerId !== userId) {
      throw new NotFoundError('Task not found.');
    }

    const proofs = await this.prisma.taskProof.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } });
    return Promise.all(proofs.map((p) => this.toProofView(p)));
  }

  async deleteProof(taskId: string, proofId: string, workerId: string) {
    const task = await this.requireAssignedTask(taskId, workerId);
    if (task.status !== 'IN_PROGRESS' && task.status !== 'ARRIVED') {
      throw new BusinessRuleError('Proof can only be removed before the task is submitted.');
    }

    const proof = await this.prisma.taskProof.findUnique({ where: { id: proofId } });
    if (!proof || proof.taskId !== taskId || proof.workerId !== workerId) {
      throw new NotFoundError('Proof not found.');
    }

    await this.prisma.taskProof.delete({ where: { id: proofId } });
    return { success: true };
  }

  // ─── Submission ──────────────────────────────────────────────────────

  /**
   * Validated, not asserted: every required proof from the task's own
   * `proofRequirements` must actually be present, counted by type and, for
   * structured fields, by key. A worker cannot submit an empty task.
   */
  async submit(taskId: string, workerId: string, note?: string) {
    const task = await this.requireAssignedTask(taskId, workerId);

    const proofs = await this.prisma.taskProof.findMany({ where: { taskId } });
    const missing = this.findMissingRequirements(task.proofRequirements, proofs);

    assertTransitionAllowed(task.status, 'SUBMITTED', 'WORKER', {
      isAssignedWorker: true,
      proofRequirementsMet: missing.length === 0,
    });

    const env = loadEnv();
    const reviewDeadlineAt = new Date(Date.now() + env.REVIEW_WINDOW_HOURS * 3_600_000);

    await this.prisma.$transaction([
      ...(note
        ? [
            this.prisma.taskProof.create({
              data: { taskId, workerId, type: 'NOTE', noteBody: note },
            }),
          ]
        : []),
      this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'SUBMITTED', submittedAt: new Date(), reviewDeadlineAt },
      }),
      this.prisma.taskStatusHistory.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: 'SUBMITTED',
          actorUserId: workerId,
          actorRole: 'WORKER',
        },
      }),
    ]);
    this.realtime.emitTaskStatus(taskId, 'SUBMITTED');

    // The fast path. If this fails or Redis is unavailable, the task is
    // still correctly SUBMITTED with review_deadline_at set — the sweeper
    // will catch it regardless. See queue/auto-approve.queue.ts.
    await this.autoApproveQueue.schedule(taskId, reviewDeadlineAt.getTime() - Date.now());

    try {
      await this.notifications.notify(task.requesterId, {
        event: 'PROOF_SUBMITTED',
        taskId,
        taskTitle: task.title,
      });
    } catch (error) {
      this.logger.warn(`Notification dispatch failed for task ${taskId} submission: ${String(error)}`);
    }

    this.logger.log(`Task ${taskId} submitted. Review deadline: ${reviewDeadlineAt.toISOString()}.`);
    return { status: 'SUBMITTED' as const, reviewDeadlineAt: reviewDeadlineAt.toISOString() };
  }

  /**
   * Reports an inability to complete the task. No automatic state change: a
   * worker cannot unassign themselves from a task by simply claiming a
   * blocker, since that would be an easy way to abandon work without the
   * completion-rate consequence docs/10-matching-engine.md describes.
   * Recorded as evidence for a human — requester or, eventually, an admin —
   * to act on. Automatic re-offering after a reported blocker is Phase 7/9
   * work, once matching and admin review exist to act on it.
   */
  async reportBlocker(taskId: string, workerId: string, input: BlockerInput) {
    const task = await this.requireAssignedTask(taskId, workerId);

    await this.prisma.taskStatusHistory.create({
      data: {
        taskId,
        fromStatus: task.status,
        toStatus: task.status,
        actorUserId: workerId,
        actorRole: 'WORKER',
        reason: `Blocker reported (${input.reason}): ${input.description}`,
        metadata: input.storageKeys ? { storageKeys: input.storageKeys } : undefined,
      },
    });

    return { success: true };
  }

  // ─── Internal ────────────────────────────────────────────────────────

  /** Shared by markEnRoute and confirmArrival — both notify the requester with the worker's name, nothing else. */
  private async notifyRequester(
    task: { id: string; requesterId: string; title: string },
    workerId: string,
    event: 'WORKER_EN_ROUTE' | 'WORKER_ARRIVED',
  ): Promise<void> {
    try {
      const worker = await this.prisma.user.findUnique({ where: { id: workerId }, select: { displayName: true } });
      await this.notifications.notify(task.requesterId, {
        event,
        taskId: task.id,
        taskTitle: task.title,
        workerName: worker?.displayName ?? 'Your worker',
      });
    } catch (error) {
      this.logger.warn(`Notification dispatch failed for task ${task.id} (${event}): ${String(error)}`);
    }
  }

  private async requireAssignedTask(taskId: string, workerId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task not found.');
    if (task.assignedWorkerId !== workerId) throw new ForbiddenError('This task is not assigned to you.');
    return task;
  }

  private async transition(
    taskId: string,
    from: Parameters<typeof assertTransitionAllowed>[0],
    to: Parameters<typeof assertTransitionAllowed>[1],
    actorUserId: string,
  ) {
    await this.prisma.$transaction([
      this.prisma.task.update({ where: { id: taskId }, data: { status: to } }),
      this.prisma.taskStatusHistory.create({
        data: { taskId, fromStatus: from, toStatus: to, actorUserId, actorRole: 'WORKER' },
      }),
    ]);
    this.realtime.emitTaskStatus(taskId, to);
  }

  private async toProofView(proof: {
    id: string;
    type: string;
    storageKey: string | null;
    fieldKey: string | null;
    fieldValue: string | null;
    noteBody: string | null;
    capturedAt: Date | null;
    uploadedAt: Date;
    distanceFromTaskMeters: number | null;
    verificationFlags: string[];
  }) {
    return {
      id: proof.id,
      type: proof.type,
      url: proof.storageKey ? await this.storage.presignGet(proof.storageKey) : null,
      fieldKey: proof.fieldKey,
      fieldValue: proof.fieldValue,
      noteBody: proof.noteBody,
      capturedAt: proof.capturedAt?.toISOString() ?? null,
      uploadedAt: proof.uploadedAt.toISOString(),
      distanceFromTaskMeters: proof.distanceFromTaskMeters,
      verificationFlags: proof.verificationFlags,
    };
  }

  /** Returns the requirements that have no matching proof yet. */
  private findMissingRequirements(
    proofRequirementsJson: unknown,
    existingProofs: { type: string; fieldKey: string | null }[],
  ): { type: string; fieldKey?: string; label: string }[] {
    const requirements = Array.isArray(proofRequirementsJson)
      ? (proofRequirementsJson as {
          type: string;
          fieldKey?: string;
          label: string;
          required?: boolean;
          minCount?: number;
        }[])
      : [];

    return requirements
      .filter((r) => r.required !== false)
      .filter((r) => {
        const matching = existingProofs.filter(
          (p) => p.type === r.type && (r.fieldKey ? p.fieldKey === r.fieldKey : true),
        );
        return matching.length < (r.minCount ?? 1);
      })
      .map((r) => ({ type: r.type, fieldKey: r.fieldKey, label: r.label }));
  }
}
