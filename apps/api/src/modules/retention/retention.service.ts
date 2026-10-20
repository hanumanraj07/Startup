import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const DAY_MS = 24 * 3_600_000;

/**
 * How long operational records are kept (docs/22, #27). Records that are
 * evidence or money are kept: chat messages, task status history, ledger
 * entries, payments, refunds, payouts, disputes, audit records, and the proof
 * of completed tasks. How long those must be kept is a legal decision (DPDP
 * Act, GST and dispute periods), not made here.
 */
export const RETENTION = {
  /** A notification the user has read. */
  readNotificationDays: 180,
  /** Any notification, read or not. */
  anyNotificationDays: 365,
  /** A webhook delivery, kept for audit, then dropped. */
  webhookEventDays: 180,
  /** A one-time code, once used or expired. */
  otpCodeDays: 30,
  /** A refresh token past its expiry (reuse detection only needs live ones). */
  refreshTokenDaysAfterExpiry: 30,
  /** Offers on a finished task (the admin dashboard's all-time offer figures read them). */
  finishedTaskOfferDays: 365,
} as const;

/** Storage deletions tried this many times are left for a person. */
const MAX_STORAGE_ATTEMPTS = 10;

/**
 * Queues storage objects for deletion, in the caller's transaction, so a
 * file is only removed once the rows that pointed at it are really gone.
 */
export async function queueStorageDeletion(
  tx: Pick<Prisma.TransactionClient, 'storageDeletion'>,
  keys: (string | null | undefined)[],
  reason: string,
): Promise<void> {
  const storageKeys = [...new Set(keys.filter((k): k is string => Boolean(k)))];
  if (storageKeys.length === 0) return;
  await tx.storageDeletion.createMany({ data: storageKeys.map((storageKey) => ({ storageKey, reason })), skipDuplicates: true });
}

/** Run daily by the worker's sweeper. Deletes only what RETENTION says may go. */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async run(now = new Date()): Promise<Record<string, number>> {
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const counts: Record<string, number> = {};

    counts.storageObjects = await this.deleteQueuedObjects();

    counts.notifications = (
      await this.prisma.notification.deleteMany({
        where: {
          deliveredAt: { not: null },
          OR: [
            { readAt: { not: null }, createdAt: { lt: before(RETENTION.readNotificationDays) } },
            { createdAt: { lt: before(RETENTION.anyNotificationDays) } },
          ],
        },
      })
    ).count;

    counts.webhookEvents = (
      await this.prisma.webhookEvent.deleteMany({ where: { createdAt: { lt: before(RETENTION.webhookEventDays) } } })
    ).count;

    counts.otpCodes = (
      await this.prisma.otpCode.deleteMany({
        where: {
          createdAt: { lt: before(RETENTION.otpCodeDays) },
          OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: now } }],
        },
      })
    ).count;

    counts.refreshTokens = (
      await this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: before(RETENTION.refreshTokenDaysAfterExpiry) } } })
    ).count;

    counts.taskOffers = (
      await this.prisma.taskOffer.deleteMany({
        where: {
          createdAt: { lt: before(RETENTION.finishedTaskOfferDays) },
          task: { status: { in: ['PAYMENT_RELEASED', 'COMPLETED', 'CANCELLED', 'EXPIRED'] } },
        },
      })
    ).count;

    this.logger.log(`Retention: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
    return counts;
  }

  private async deleteQueuedObjects(): Promise<number> {
    const pending = await this.prisma.storageDeletion.findMany({
      where: { deletedAt: null, attempts: { lt: MAX_STORAGE_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    let deleted = 0;
    for (const item of pending) {
      try {
        await this.storage.deleteObject(item.storageKey);
        await this.prisma.storageDeletion.update({ where: { id: item.id }, data: { deletedAt: new Date(), attempts: { increment: 1 } } });
        deleted += 1;
      } catch (error) {
        await this.prisma.storageDeletion.update({ where: { id: item.id }, data: { attempts: { increment: 1 } } });
        this.logger.warn(`Could not delete stored object ${item.storageKey}: ${String(error)}`);
      }
    }
    return deleted;
  }
}
