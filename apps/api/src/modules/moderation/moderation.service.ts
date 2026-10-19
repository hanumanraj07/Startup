import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { AdminModerationListInput, ModerationDecisionInput } from '@onsite/validation';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { AuditService } from '../../common/audit.service';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  PostingRestrictedError,
  TaskBlockedError,
} from '../../common/errors';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { describeAiCategories, OpenAiModerationClient } from './openai-moderation.client';

export type ModerationStage = 'CREATE' | 'UPDATE' | 'PUBLISH';

/** How long after a block the user may still ask for a human review. */
const APPEAL_WINDOW_MS = 7 * 86_400_000;

/**
 * Task moderation: the posting cooldown, the block itself, and appeals.
 *
 * Every task write path (create, edit, publish) calls `screenTask`, so the
 * rules hold no matter which screen or client sent the request. Order:
 *
 *  1. Inside a cooldown → refused before anything else is looked at.
 *  2. Same content a human already cleared for this user → allowed.
 *  3. Keyword rules (RiskService, passed in) → block.
 *  4. OpenAI Moderation, when configured → block if flagged.
 *
 * A block records a ModerationEvent (which starts the cooldown) and an audit
 * row, then throws TaskBlockedError carrying the event id so the user can
 * appeal. See docs/12-trust-safety.md.
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: OpenAiModerationClient,
    private readonly notifications: NotificationService,
  ) {}

  async getActiveRestriction(userId: string): Promise<{ eventId: string; until: Date; reason: string } | null> {
    const event = await this.prisma.moderationEvent.findFirst({
      where: { userId, restrictedUntil: { gt: new Date() }, appealStatus: { not: 'OVERTURNED' } },
      orderBy: { restrictedUntil: 'desc' },
      select: { id: true, restrictedUntil: true, reason: true },
    });
    return event ? { eventId: event.id, until: event.restrictedUntil, reason: event.reason } : null;
  }

  /** Throws PostingRestrictedError while the user is inside a cooldown. */
  async assertNotRestricted(userId: string): Promise<void> {
    const restriction = await this.getActiveRestriction(userId);
    if (!restriction) return;
    const retryAfterSeconds = Math.max(1, Math.ceil((restriction.until.getTime() - Date.now()) / 1000));
    throw new PostingRestrictedError(
      `You can't post or edit tasks for ${formatWait(retryAfterSeconds)}, because a recent task broke our rules (${restriction.reason}).`,
      {
        eventId: restriction.eventId,
        retryAfterSeconds,
        restrictedUntil: restriction.until.toISOString(),
      },
    );
  }

  async screenTask(params: {
    userId: string;
    stage: ModerationStage;
    title: string;
    description: string;
    /** The keyword-rule verdict, from RiskService.findProhibitedMatch. */
    ruleReason: string | undefined;
    taskId?: string;
    actorIp?: string;
  }): Promise<void> {
    const { userId, stage, title, description, ruleReason, taskId, actorIp } = params;
    await this.assertNotRestricted(userId);

    const contentHash = hashContent(title, description);
    const cleared = await this.prisma.moderationEvent.findFirst({
      where: { userId, contentHash, appealStatus: 'OVERTURNED' },
      select: { id: true },
    });
    if (cleared) return;

    let verdict: { source: 'RULES' | 'AI'; reason: string; categories: string[] } | null = null;
    if (ruleReason) {
      verdict = { source: 'RULES', reason: ruleReason, categories: [ruleReason] };
    } else if (stage !== 'PUBLISH') {
      // Publish re-runs the rules only: the content was already put through
      // the AI check when it was written, and has not changed since.
      const ai = await this.ai.classify(`${title}\n\n${description}`);
      if (ai?.flagged) {
        verdict = { source: 'AI', reason: describeAiCategories(ai.categories), categories: ai.categories };
      }
    }
    if (!verdict) return;

    const cooldownSeconds = loadEnv().MODERATION_COOLDOWN_SECONDS;
    const restrictedUntil = new Date(Date.now() + cooldownSeconds * 1000);
    const event = await this.prisma.moderationEvent.create({
      data: {
        userId,
        taskId,
        stage,
        title,
        description,
        contentHash,
        source: verdict.source,
        reason: verdict.reason,
        categories: verdict.categories,
        restrictedUntil,
      },
    });

    await this.audit.record({
      actorUserId: userId,
      actorIp,
      action: 'PROHIBITED_TASK_BLOCKED',
      entityType: 'Task',
      entityId: taskId,
      after: { reason: verdict.reason, source: verdict.source, title, description, moderationEventId: event.id },
    });
    this.logger.warn(`Task content blocked for user ${userId} (${verdict.source}: ${verdict.reason}).`);

    throw new TaskBlockedError(
      `This task can't be posted: it appears to involve ${verdict.reason}. OnSite does not allow tasks that could harm people or break the law.` +
        (cooldownSeconds > 0 ? ` You can't post or edit tasks for the next ${formatWait(cooldownSeconds)}.` : ''),
      {
        eventId: event.id,
        reason: verdict.reason,
        retryAfterSeconds: cooldownSeconds,
        restrictedUntil: restrictedUntil.toISOString(),
        canAppeal: true,
      },
    );
  }

  // ─── Appeals ─────────────────────────────────────────────────────────

  async appeal(eventId: string, userId: string, note: string) {
    const event = await this.prisma.moderationEvent.findUnique({ where: { id: eventId } });
    if (!event || event.userId !== userId) throw new NotFoundError('That moderation decision was not found.');
    if (event.appealStatus !== 'NONE') throw new ConflictError('A review has already been requested for this decision.');
    if (Date.now() - event.createdAt.getTime() > APPEAL_WINDOW_MS) {
      throw new BusinessRuleError('Reviews can be requested within 7 days of the decision.');
    }

    await this.prisma.moderationEvent.update({
      where: { id: eventId },
      data: { appealStatus: 'PENDING', appealNote: note, appealedAt: new Date() },
    });
    return { appealStatus: 'PENDING' as const };
  }

  // ─── Admin ───────────────────────────────────────────────────────────

  async listForAdmin(query: AdminModerationListInput) {
    const cursorData = query.cursor ? decodeCursor<{ createdAt: string; id: string }>(query.cursor) : null;
    const events = await this.prisma.moderationEvent.findMany({
      where: {
        ...(query.status === 'PENDING' && { appealStatus: 'PENDING' }),
        ...(cursorData && {
          OR: [
            { createdAt: { lt: new Date(cursorData.createdAt) } },
            { createdAt: new Date(cursorData.createdAt), id: { lt: cursorData.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });

    const hasMore = events.length > query.limit;
    const page = events.slice(0, query.limit);
    const since = new Date(Date.now() - 86_400_000);
    const counts = await this.prisma.moderationEvent.groupBy({
      by: ['userId'],
      where: { userId: { in: [...new Set(page.map((e) => e.userId))] }, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const recentByUser = new Map(counts.map((c) => [c.userId, c._count._all]));
    const last = page.at(-1);

    return {
      data: page.map((e) => ({
        id: e.id,
        user: e.user,
        stage: e.stage,
        title: e.title,
        description: e.description,
        source: e.source,
        reason: e.reason,
        categories: e.categories,
        createdAt: e.createdAt.toISOString(),
        restrictedUntil: e.restrictedUntil.toISOString(),
        appealStatus: e.appealStatus,
        appealNote: e.appealNote,
        appealedAt: e.appealedAt?.toISOString() ?? null,
        reviewNote: e.reviewNote,
        reviewedAt: e.reviewedAt?.toISOString() ?? null,
        blocksLast24h: recentByUser.get(e.userId) ?? 1,
      })),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    };
  }

  async decide(eventId: string, adminId: string, input: ModerationDecisionInput, actorIp?: string) {
    const event = await this.prisma.moderationEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundError('That moderation decision was not found.');
    if (event.appealStatus === 'UPHELD' || event.appealStatus === 'OVERTURNED') {
      throw new ConflictError('This decision has already been reviewed.');
    }

    const overturn = input.decision === 'OVERTURN';
    const now = new Date();
    const updated = await this.prisma.moderationEvent.update({
      where: { id: eventId },
      data: {
        appealStatus: overturn ? 'OVERTURNED' : 'UPHELD',
        reviewedById: adminId,
        reviewNote: input.note,
        reviewedAt: now,
        // Overturning lifts the cooldown at once.
        ...(overturn && event.restrictedUntil > now && { restrictedUntil: now }),
      },
    });

    await this.audit.record({
      actorUserId: adminId,
      actorIp,
      action: overturn ? 'MODERATION_OVERTURNED' : 'MODERATION_UPHELD',
      entityType: 'ModerationEvent',
      entityId: eventId,
      before: { appealStatus: event.appealStatus },
      after: { appealStatus: updated.appealStatus, note: input.note },
    });

    try {
      await this.notifications.notify(event.userId, {
        event: 'MODERATION_REVIEWED',
        taskTitle: event.title,
        overturned: overturn,
      });
    } catch (error) {
      this.logger.warn(`Notification dispatch failed for moderation review ${eventId}: ${String(error)}`);
    }

    return { id: updated.id, appealStatus: updated.appealStatus };
  }
}

/** sha256 of the trimmed, case-folded content; whitespace runs collapsed so a re-typed space doesn't count as new content. */
export function hashContent(title: string, description: string): string {
  const fold = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(`${fold(title)}\n${fold(description)}`).digest('hex');
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
