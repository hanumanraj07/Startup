import { describe, expect, it, vi } from 'vitest';
import { TasksService } from './tasks.service';
import { RiskService } from './risk.service';
import { BusinessRuleError } from '../../common/errors';

/**
 * A blocked prohibited-content attempt is a trust & safety signal, not just
 * a 400 the client silently absorbs (ai/memory.md, 2026-09-24: found while
 * answering "what happens if someone posts a task to kill someone" — the
 * prohibited-content check existed, but nothing recorded that an attempt
 * happened). This asserts the audit write actually fires, with the real
 * reason and content, and — just as importantly — that it does NOT fire on
 * ordinary content, so this isn't logging every task creation.
 */

const REQUESTER_ID = 'req-1';

function buildService(auditRecord: ReturnType<typeof vi.fn>) {
  const prisma = {
    category: { findFirst: vi.fn().mockResolvedValue({ id: 'cat-1', slug: 'local-research' }) },
  };
  const geo = { findNearestCity: vi.fn().mockResolvedValue({ id: 'city-1' }) };
  const audit = { record: auditRecord };

  return new TasksService(
    prisma as never,
    geo as never,
    new RiskService(),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
  );
}

const baseInput = {
  categorySlug: 'local-research' as never,
  taskLocation: { latitude: 22.5675, longitude: 88.351 },
  taskAddress: 'Central Kolkata',
  budgetPaise: 50_000,
  deadlineAt: new Date(Date.now() + 3_600_000),
  proofRequirements: [{ type: 'PHOTO' as const, label: 'Photo', required: true }],
};

describe('TasksService — prohibited-content attempts are audited', () => {
  it('records the blocked attempt, with the real reason and content, before rethrowing', async () => {
    const auditRecord = vi.fn().mockResolvedValue(undefined);
    const service = buildService(auditRecord);

    await expect(
      service.create(
        REQUESTER_ID,
        { ...baseInput, title: 'Urgent task', description: 'I need someone to kill my neighbor' },
        '203.0.113.5',
      ),
    ).rejects.toThrow(BusinessRuleError);

    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: REQUESTER_ID,
        actorIp: '203.0.113.5',
        action: 'PROHIBITED_TASK_BLOCKED',
        entityType: 'Task',
        after: expect.objectContaining({
          reason: 'violence or a threat against a person',
          description: 'I need someone to kill my neighbor',
        }),
      }),
    );
  });

  it('does not record anything for ordinary content', async () => {
    const auditRecord = vi.fn().mockResolvedValue(undefined);
    const service = buildService(auditRecord);

    // Content is clean, so this will fail later for an unrelated reason
    // (no full Prisma mock beyond category/geo) — only whether the audit
    // fired is under test here.
    await expect(
      service.create(
        REQUESTER_ID,
        { ...baseInput, title: 'Inspect a laptop', description: 'Check stock and take photos at the shop.' },
      ),
    ).rejects.toThrow();

    expect(auditRecord).not.toHaveBeenCalled();
  });
});
