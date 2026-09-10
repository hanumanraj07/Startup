import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';

export interface PushPayload {
  title: string;
  body: string;
  /** Deep link data — docs/13: "Every notification opens the exact screen it concerns." */
  data?: Record<string, unknown>;
}

/**
 * Real Web Push, not a stub: this sends through the actual browser push
 * services (FCM for Chrome, Mozilla's push service for Firefox, and so on)
 * using the standard Web Push protocol, which needs only a self-generated
 * VAPID keypair — no third-party account, unlike SMS or email-via-SMTP.
 * Generate one with `pnpm exec web-push generate-vapid-keys` and set
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
 *
 * What is NOT proven end-to-end in this codebase yet: a real browser
 * actually receiving a push. That needs a service worker calling
 * `pushManager.subscribe()` from the installed worker PWA, which does not
 * exist until the web app's worker UI is built. This service is fully
 * functional and unit-tested against the `web-push` library; the missing
 * piece is the browser-side subscriber, not the server-side sender.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private configured = false;

  constructor(private readonly prisma: PrismaService) {}

  private ensureConfigured(): boolean {
    if (this.configured) return true;
    const env = loadEnv();
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
      this.logger.warn('Web Push is not configured (VAPID_* env vars missing); push notifications are skipped.');
      return false;
    }
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    this.configured = true;
    return true;
  }

  /**
   * Sends to every subscription a user has (they may have several — phone,
   * laptop, and so on). A subscription the push service reports as gone
   * (410, or 404 on some services) is deleted rather than retried forever,
   * per docs/13. Any other failure is logged and does not affect the other
   * subscriptions or the caller — a failed push must never fail the action
   * that triggered it.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<{ sent: number }> {
    if (!this.ensureConfigured()) return { sent: 0 };

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
    let sent = 0;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
        sent += 1;
        await this.prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { lastUsedAt: new Date() },
        });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          this.logger.log(`Removed expired push subscription ${sub.id} for user ${userId}.`);
        } else {
          this.logger.warn(`Push to subscription ${sub.id} failed: ${String(error)}`);
        }
      }
    }

    return { sent };
  }
}
