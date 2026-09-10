import { Injectable } from '@nestjs/common';
import type { BlockUserInput, ReportUserInput } from '@onsite/validation';
import { BusinessRuleError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Reporting and blocking. docs/12-trust-safety.md's "Reporting and
 * enforcement" table: a report enters the safety queue (Phase 9's admin
 * console reads it — see admin module); a block is mutual exclusion from
 * matching, permanently.
 */
@Injectable()
export class SafetyService {
  constructor(private readonly prisma: PrismaService) {}

  async report(reporterId: string, input: ReportUserInput): Promise<{ success: true }> {
    if (input.reportedUserId === reporterId) {
      throw new BusinessRuleError('You cannot report yourself.');
    }
    await this.prisma.report.create({
      data: {
        reporterId,
        reportedUserId: input.reportedUserId,
        taskId: input.taskId,
        reason: input.reason,
        description: input.description,
      },
    });
    return { success: true };
  }

  /** Idempotent: blocking someone already blocked just updates the reason. */
  async block(blockerId: string, blockedId: string, input: BlockUserInput): Promise<{ success: true }> {
    if (blockedId === blockerId) {
      throw new BusinessRuleError('You cannot block yourself.');
    }
    await this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      update: { reason: input.reason },
      create: { blockerId, blockedId, reason: input.reason },
    });
    return { success: true };
  }

  /**
   * Every user id in a mutual block with `userId`, either direction —
   * blocking is "mutual exclusion from matching" per docs/12, so it does not
   * matter who blocked whom. Used by MatchingService and TasksService.accept
   * to keep two blocked users from ever being matched or transacting again.
   */
  async getBlockedUserIds(userId: string): Promise<string[]> {
    const blocks = await this.prisma.userBlock.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const ids = new Set<string>();
    for (const b of blocks) {
      ids.add(b.blockerId === userId ? b.blockedId : b.blockerId);
    }
    return [...ids];
  }

  async isBlocked(userIdA: string, userIdB: string): Promise<boolean> {
    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: userIdA, blockedId: userIdB },
          { blockerId: userIdB, blockedId: userIdA },
        ],
      },
      select: { blockerId: true },
    });
    return Boolean(block);
  }
}
