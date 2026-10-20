import { Inject, Injectable, Logger } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationQueue } from '../../queue/notification.queue';
import { EMAIL_PROVIDER, type EmailProvider } from '../messaging/providers';
import { EVENT_DEFINITIONS, NOTIFICATION_CATEGORIES, type NotificationCategory, type NotificationPayload } from './events';
import { PushService } from './push.service';
import { renderNotification } from './templates';

/** Per-category opt-outs. A missing category, or a missing push/email key within it, defaults to enabled. */
export type UserNotificationPrefs = Partial<Record<NotificationCategory, { push?: boolean; email?: boolean }>>;

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  readAt: string | null;
  createdAt: string;
}

/**
 * The single dispatch point for every notification the platform sends —
 * docs/13's "Notification logic scattered across services is how a
 * marketplace ends up sending four messages for one event, or none." Nothing
 * else should write to the `notifications` table or call PushService/the
 * email provider directly for a user-facing event.
 *
 * In-app is always written, regardless of preference — it is the durable
 * record docs/13 calls "the fallback for everything." Push and email are
 * gated by the event's declared channels, the user's stored preference, and
 * `nonDisableable` overriding that preference for payment-carrying events.
 *
 * Push and email are not sent here (docs/22, #17). The row is written with
 * the channels still to send (an outbox) and the worker process delivers
 * them (`deliver`), with retries; a sweep catches any whose queued job was
 * lost. One slow provider used to slow every action that notified anyone.
 */

/** A claim on a delivery older than this is from a process that died mid-send. */
const STALE_CLAIM_MS = 5 * 60_000;
/** After this many attempts a delivery gives up and records why. */
export const MAX_DELIVERY_ATTEMPTS = 6;
/** The sweep leaves fresh rows to the queue. */
const SWEEP_AFTER_MS = 2 * 60_000;
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly queue: NotificationQueue,
  ) {}

  /** Writes the in-app notification and queues its push and email. Never waits on a provider. */
  async notify(userId: string, payload: NotificationPayload): Promise<void> {
    const def = EVENT_DEFINITIONS[payload.event];
    const rendered = renderNotification(payload);

    const prefs = await this.getPreferences(userId);
    const categoryPrefs = prefs[def.category];
    const pending: string[] = [];
    if (def.channels.includes('PUSH') && (def.nonDisableable || categoryPrefs?.push !== false)) pending.push('PUSH');
    if (def.channels.includes('EMAIL') && (def.nonDisableable || categoryPrefs?.email !== false)) pending.push('EMAIL');

    const row = await this.prisma.notification.create({
      data: {
        userId,
        type: payload.event,
        title: rendered.title,
        body: rendered.body,
        data: payload as object,
        channels: [...def.channels],
        pendingChannels: pending,
        deliveredAt: pending.length === 0 ? new Date() : null,
      },
      select: { id: true },
    });

    if (pending.length > 0) await this.queue.enqueue(row.id);
  }

  /**
   * Sends a notification's pending push and email, each at most once.
   * Called by the worker's queue consumer and by the sweep. A claim makes a
   * second deliverer back off; a claim left by a process that died is taken
   * over after STALE_CLAIM_MS. Returns RETRY while a channel is still unsent
   * (the queue then retries with backoff), DONE otherwise, including when it
   * gives up after MAX_DELIVERY_ATTEMPTS.
   */
  async deliver(notificationId: string, now = new Date()): Promise<'DONE' | 'RETRY' | 'SKIPPED'> {
    const claimed = await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        deliveredAt: null,
        OR: [{ deliveryClaimedAt: null }, { deliveryClaimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
      },
      data: { deliveryClaimedAt: now, deliveryAttempts: { increment: 1 } },
    });
    if (claimed.count === 0) return 'SKIPPED';

    const n = await this.prisma.notification.findUniqueOrThrow({ where: { id: notificationId } });
    const message = { title: n.title, body: n.body };
    const done: { pushSentAt?: Date; emailSentAt?: Date } = {};
    let error: string | null = null;

    if (n.pendingChannels.includes('PUSH') && !n.pushSentAt) {
      try {
        // PushService swallows per-device failures (and drops dead ones), so
        // an attempt counts as sent: a retry would repeat it on devices that
        // already received it.
        await this.push.sendToUser(n.userId, { ...message, data: { event: n.type } });
        done.pushSentAt = new Date();
      } catch (e) {
        error = `push: ${String(e)}`;
      }
    }
    if (n.pendingChannels.includes('EMAIL') && !n.emailSentAt) {
      try {
        const user = await this.prisma.user.findUnique({ where: { id: n.userId }, select: { email: true } });
        if (user) await this.email.send({ to: user.email, subject: n.title, body: n.body });
        done.emailSentAt = new Date();
      } catch (e) {
        error = `${error ? error + '; ' : ''}email: ${String(e)}`;
      }
    }

    const pushLeft = n.pendingChannels.includes('PUSH') && !n.pushSentAt && !done.pushSentAt;
    const emailLeft = n.pendingChannels.includes('EMAIL') && !n.emailSentAt && !done.emailSentAt;
    const finished = !pushLeft && !emailLeft;
    const givingUp = !finished && n.deliveryAttempts >= MAX_DELIVERY_ATTEMPTS;

    await this.prisma.notification.update({
      where: { id: n.id },
      data: {
        ...done,
        deliveryError: error,
        deliveryClaimedAt: null,
        ...((finished || givingUp) && { deliveredAt: new Date() }),
      },
    });
    if (givingUp) this.logger.warn(`Notification ${n.id} (${n.type}) gave up after ${n.deliveryAttempts} attempts: ${error}`);
    return finished || givingUp ? 'DONE' : 'RETRY';
  }

  /** The sweep: deliveries whose queued job was lost, or whose retries outlived the queue. */
  async deliverPending(now = new Date()): Promise<number> {
    const due = await this.prisma.notification.findMany({
      where: { deliveredAt: null, createdAt: { lte: new Date(now.getTime() - SWEEP_AFTER_MS) } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    let delivered = 0;
    for (const { id } of due) {
      try {
        if ((await this.deliver(id, now)) === 'DONE') delivered += 1;
      } catch (error) {
        this.logger.warn(`Notification ${id} delivery failed in the sweep: ${String(error)}`);
      }
    }
    return delivered;
  }

  async list(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ data: NotificationView[]; nextCursor: string | null }> {
    const cursorData = cursor ? decodeCursor<{ createdAt: string; id: string }>(cursor) : null;

    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
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

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);

    return {
      data: page.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    };
  }

  /** Marks the given notification ids read, or every unread notification if none are given — both scoped to the caller's own. */
  async markRead(userId: string, ids?: string[]): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids && ids.length > 0 ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async getPreferences(userId: string): Promise<UserNotificationPrefs> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    return (user?.notificationPrefs as UserNotificationPrefs | null) ?? {};
  }

  /** Merges the given categories into the stored preferences rather than replacing the whole object. */
  async updatePreferences(userId: string, patch: UserNotificationPrefs): Promise<UserNotificationPrefs> {
    const current = await this.getPreferences(userId);
    const merged: UserNotificationPrefs = { ...current };
    for (const category of NOTIFICATION_CATEGORIES) {
      if (patch[category]) {
        merged[category] = { ...current[category], ...patch[category] };
      }
    }
    await this.prisma.user.update({ where: { id: userId }, data: { notificationPrefs: merged as object } });
    return merged;
  }

  async subscribePush(
    userId: string,
    subscription: { endpoint: string; p256dh: string; auth: string; userAgent?: string },
  ): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      // A subscription's endpoint is issued per browser/device; if the same
      // endpoint resubscribes (e.g. after a service worker update) it should
      // move to whichever user now owns it rather than erroring.
      update: { userId, p256dh: subscription.p256dh, auth: subscription.auth, userAgent: subscription.userAgent },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        userAgent: subscription.userAgent,
      },
    });
  }

  async unsubscribePush(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }
}
