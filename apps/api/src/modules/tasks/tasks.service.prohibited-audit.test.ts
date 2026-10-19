import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TasksService } from './tasks.service';
import { RiskService } from './risk.service';
import { PostingRestrictedError, TaskBlockedError } from '../../common/errors';
import { resetEnvCache } from '../../config/env';
import { ModerationService } from '../moderation/moderation.service';

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

const BASE_ENV = {
  DATABASE_URL: 'postgresql://onsite:onsite@localhost:5432/onsite_app',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_BUCKET: 'onsite-media',
  STORAGE_ACCESS_KEY: 'x',
  STORAGE_SECRET_KEY: 'y',
  MODERATION_COOLDOWN_SECONDS: '300',
};

beforeEach(() => {
  resetEnvCache();
  process.env = { ...process.env, ...BASE_ENV };
  delete process.env.OPENAI_API_KEY;
});

/** An in-memory moderation_events table, enough for the cooldown to be real. */
function fakeModerationEvents() {
  const rows: { id: string; userId: string; restrictedUntil: Date; appealStatus: string; reason: string; contentHash: string }[] = [];
  return {
    rows,
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const now = new Date();
      return (
        rows.find((r) =>
          r.userId === where.userId &&
          (where.contentHash ? r.contentHash === where.contentHash && r.appealStatus === where.appealStatus : r.restrictedUntil > now && r.appealStatus !== 'OVERTURNED'),
        ) ?? null
      );
    }),
    create: vi.fn(async ({ data }: { data: (typeof rows)[number] }) => {
      const row = { ...data, id: `evt-${rows.length + 1}`, appealStatus: 'NONE' };
      rows.push(row);
      return row;
    }),
  };
}

function buildService(auditRecord: ReturnType<typeof vi.fn>, events = fakeModerationEvents()) {
  const prisma = {
    category: { findFirst: vi.fn().mockResolvedValue({ id: 'cat-1', slug: 'local-research' }) },
    moderationEvent: events,
  };
  const geo = { findNearestCity: vi.fn().mockResolvedValue({ id: 'city-1' }) };
  const audit = { record: auditRecord };
  const ai = { classify: vi.fn().mockResolvedValue(null) };
  const moderation = new ModerationService(prisma as never, audit as never, ai as never, {} as never);

  return new TasksService(
    prisma as never,
    geo as never,
    new RiskService(),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    moderation,
    {} as never,
    {} as never,
    {} as never,
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
    ).rejects.toThrow(TaskBlockedError);

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

  it('restricts posting for the cooldown after a block, even for clean content', async () => {
    const auditRecord = vi.fn().mockResolvedValue(undefined);
    const service = buildService(auditRecord);

    await expect(
      service.create(REQUESTER_ID, { ...baseInput, title: 'Task', description: 'Spy on my neighbour and report back' }),
    ).rejects.toThrow(TaskBlockedError);

    // A clean resubmission inside the five minutes is refused server-side,
    // before the content is even looked at.
    await expect(
      service.create(REQUESTER_ID, { ...baseInput, title: 'Inspect a laptop', description: 'Check stock and take photos.' }),
    ).rejects.toThrow(PostingRestrictedError);
    expect(auditRecord).toHaveBeenCalledTimes(1);
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
