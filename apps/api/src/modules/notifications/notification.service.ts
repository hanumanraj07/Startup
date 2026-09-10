import { Inject, Injectable, Logger } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '@onsite/utils';
import { PrismaService } from '../../prisma/prisma.service';
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
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  async notify(userId: string, payload: NotificationPayload): Promise<void> {
    const def = EVENT_DEFINITIONS[payload.event];
    const rendered = renderNotification(payload);

    await this.prisma.notification.create({
      data: {
        userId,
        type: payload.event,
        title: rendered.title,
        body: rendered.body,
        data: payload as object,
        channels: [...def.channels],
      },
    });

    const prefs = await this.getPreferences(userId);
    const categoryPrefs = prefs[def.category];
    const pushEnabled = def.nonDisableable || categoryPrefs?.push !== false;
    const emailEnabled = def.nonDisableable || categoryPrefs?.email !== false;

    if (def.channels.includes('PUSH') && pushEnabled) {
      try {
        await this.push.sendToUser(userId, { title: rendered.title, body: rendered.body, data: { event: payload.event } });
      } catch (error) {
        // A failed push must never fail the action that triggered it.
        this.logger.warn(`Push dispatch failed for user ${userId}, event ${payload.event}: ${String(error)}`);
      }
    }

    if (def.channels.includes('EMAIL') && emailEnabled) {
      try {
        const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
        if (user) {
          await this.email.send({ to: user.email, subject: rendered.title, body: rendered.body });
        }
      } catch (error) {
        this.logger.warn(`Email dispatch failed for user ${userId}, event ${payload.event}: ${String(error)}`);
      }
    }
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
