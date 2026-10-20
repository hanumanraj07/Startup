import { describe, expect, it, vi } from 'vitest';
import { RETENTION, RetentionService } from './retention.service';

/** docs/22, #27: what retention may delete, and what it must keep. */

const DAY = 24 * 3_600_000;

function build() {
  const deleteMany = () => vi.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    task: { findMany: vi.fn().mockResolvedValue([]) },
    storageDeletion: { findMany: vi.fn().mockResolvedValue([]) },
    notification: { deleteMany: deleteMany() },
    webhookEvent: { deleteMany: deleteMany() },
    otpCode: { deleteMany: deleteMany() },
    refreshToken: { deleteMany: deleteMany() },
    taskOffer: { deleteMany: deleteMany() },
  };
  return { service: new RetentionService(prisma as never, {} as never), prisma };
}

describe('RetentionService', () => {
  it('clears chat and proof of finished tasks after a year, or three if the task was disputed', async () => {
    const { service, prisma } = build();
    const now = new Date('2028-01-01T00:00:00Z');

    await service.run(now);

    const where = prisma.task.findMany.mock.calls[0]?.[0].where;
    expect(where.status.in).toEqual(['PAYMENT_RELEASED', 'COMPLETED', 'CANCELLED', 'EXPIRED']);
    const [undisputed, anyTask] = where.AND[0].OR;
    expect(undisputed.disputes).toEqual({ none: {} });
    expect(undisputed.updatedAt.lt.getTime()).toBe(now.getTime() - RETENTION.closedTaskEvidenceDays * DAY);
    expect(anyTask.disputes).toBeUndefined();
    expect(anyTask.updatedAt.lt.getTime()).toBe(now.getTime() - RETENTION.disputedTaskEvidenceDays * DAY);
  });

  it('never touches money or audit records', () => {
    const source = RetentionService.toString();
    for (const model of ['payment', 'ledgerEntry', 'refund', 'payout', 'itemPurchase', 'dispute', 'auditLog', 'taskStatusHistory']) {
      expect(source).not.toMatch(new RegExp(`\\.${model}\\.delete`));
    }
  });
});
