import { Injectable, Logger } from '@nestjs/common';
import type { SendMessageInput } from '@onsite/validation';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { ForbiddenError, NotFoundError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { redactContactInfo } from './redaction';

export interface ChatMessageView {
  id: string;
  taskId: string;
  senderId: string;
  isMine: boolean;
  /** Never the raw body — see redaction.ts and the Message model's own comment. */
  body: string;
  redactionFlags: string[];
  attachmentKey: string | null;
  createdAt: string;
  readAt: string | null;
}

/**
 * Task chat between a requester and their assigned worker. Every message is
 * redacted server-side before it is ever returned to a client — see
 * redaction.ts. The raw body is retained in the database only as dispute
 * evidence (Phase 9's admin review), never served by this service to anyone,
 * including the sender: what you wrote and what the other party can see are
 * deliberately allowed to differ, because the whole point is that contact
 * details never successfully cross the platform boundary even from your own
 * "sent" view.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Persists the message, then tells the other party twice: immediately over
   * the Socket.IO room if they are connected, and durably through
   * NotificationService (in-app record plus push) either way — a socket
   * emit is fire-and-forget with no delivery guarantee, so it is a UX
   * accelerant, never the only notice a new message occurred.
   */
  async send(taskId: string, senderId: string, input: SendMessageInput): Promise<ChatMessageView> {
    const task = await this.requirePartyToTask(taskId, senderId);
    if (!task.assignedWorkerId) {
      // Unreachable: requirePartyToTask already refuses an unassigned task.
      // This exists only so TypeScript can narrow assignedWorkerId to
      // `string` for the ternary below, without a non-null assertion.
      throw new Error('Invariant violated: requirePartyToTask returned a task with no assigned worker.');
    }
    const otherPartyId = task.requesterId === senderId ? task.assignedWorkerId : task.requesterId;

    const rawBody = input.body ?? '';
    const { redactedBody, flags } = redactContactInfo(rawBody);

    const message = await this.prisma.message.create({
      data: {
        taskId,
        senderId,
        body: rawBody,
        redactedBody,
        redactionFlags: flags,
        attachmentKey: input.attachmentKey,
      },
    });

    if (flags.length > 0) {
      this.logger.warn(`Message ${message.id} on task ${taskId} had contact info redacted: ${flags.join(', ')}`);
    }

    const view = this.toView(message, senderId);

    // Best-effort real-time delivery. Never lets a socket problem fail the
    // send itself — the message is already durably stored above.
    try {
      this.realtime.emitNewMessage(taskId, view);
    } catch (error) {
      this.logger.warn(`Realtime broadcast failed for message ${message.id}: ${String(error)}`);
    }

    try {
      const sender = await this.prisma.user.findUnique({ where: { id: senderId }, select: { displayName: true } });
      await this.notifications.notify(otherPartyId, {
        event: 'NEW_MESSAGE',
        taskId,
        senderName: sender?.displayName ?? 'Someone',
        preview: redactedBody,
      });
    } catch (error) {
      this.logger.warn(`Notification dispatch failed for message ${message.id}: ${String(error)}`);
    }

    return view;
  }

  async list(
    taskId: string,
    currentUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ data: ChatMessageView[]; nextCursor: string | null }> {
    await this.requirePartyToTask(taskId, currentUserId);

    const cursorData = cursor ? decodeCursor<{ createdAt: string; id: string }>(cursor) : null;

    const messages = await this.prisma.message.findMany({
      where: {
        taskId,
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

    const hasMore = messages.length > limit;
    const page = messages.slice(0, limit);
    const last = page.at(-1);

    return {
      data: page.map((m) => this.toView(m, currentUserId)),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    };
  }

  /** Marks every message from the other party as read. Idempotent. */
  async markRead(taskId: string, currentUserId: string): Promise<{ updated: number }> {
    await this.requirePartyToTask(taskId, currentUserId);

    const result = await this.prisma.message.updateMany({
      where: { taskId, senderId: { not: currentUserId }, readAt: null },
      data: { readAt: new Date() },
    });

    return { updated: result.count };
  }

  /**
   * Chat opens once a worker is assigned — there is no "other party" before
   * that — and stays open through the rest of the task's life, including
   * after completion, since a requester or worker may still need to discuss
   * something covered by the task (and dispute evidence review reads this
   * same history). Anyone who is neither party gets NotFoundError, matching
   * TasksService.getById's role-projection pattern: existence of a task they
   * have no relationship to is not information they need.
   */
  private async requirePartyToTask(taskId: string, userId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task not found.');

    const isRequester = task.requesterId === userId;
    const isAssignedWorker = task.assignedWorkerId === userId;
    if (!isRequester && !isAssignedWorker) throw new NotFoundError('Task not found.');
    if (!task.assignedWorkerId) {
      throw new ForbiddenError('Chat opens once a worker has been assigned to this task.');
    }

    return task;
  }

  private toView(
    message: {
      id: string;
      taskId: string;
      senderId: string;
      redactedBody: string;
      redactionFlags: string[];
      attachmentKey: string | null;
      createdAt: Date;
      readAt: Date | null;
    },
    currentUserId: string,
  ): ChatMessageView {
    return {
      id: message.id,
      taskId: message.taskId,
      senderId: message.senderId,
      isMine: message.senderId === currentUserId,
      body: message.redactedBody,
      redactionFlags: message.redactionFlags,
      attachmentKey: message.attachmentKey,
      createdAt: message.createdAt.toISOString(),
      readAt: message.readAt?.toISOString() ?? null,
    };
  }
}
