import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, PostingRestrictedError, TaskBlockedError } from '../../common/errors';
import { resetEnvCache } from '../../config/env';
import { hashContent, ModerationService } from './moderation.service';
import { describeAiCategories } from './openai-moderation.client';

/** Narrows away undefined in a test, failing loudly instead of with a non-null assertion. */
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value");
  return value;
}

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
});

interface EventRow {
  id: string;
  userId: string;
  contentHash: string;
  restrictedUntil: Date;
  appealStatus: string;
  reason: string;
  title: string;
  createdAt: Date;
}

function build(aiVerdict: { flagged: boolean; categories: string[] } | null = null) {
  const rows: EventRow[] = [];
  const moderationEvent = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const now = new Date();
      return (
        rows.find((r) =>
          r.userId === where.userId &&
          (where.contentHash
            ? r.contentHash === where.contentHash && r.appealStatus === where.appealStatus
            : r.restrictedUntil > now && r.appealStatus !== 'OVERTURNED'),
        ) ?? null
      );
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null),
    create: vi.fn(async ({ data }: { data: Omit<EventRow, 'id' | 'appealStatus' | 'createdAt'> }) => {
      const row = { ...data, id: `evt-${rows.length + 1}`, appealStatus: 'NONE', createdAt: new Date() };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<EventRow> }) => {
      const row = must(rows.find((r) => r.id === where.id));
      Object.assign(row, data);
      return row;
    }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const ai = { classify: vi.fn().mockResolvedValue(aiVerdict) };
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const service = new ModerationService({ moderationEvent } as never, audit as never, ai as never, notifications as never);
  return { service, rows, audit, ai, notifications };
}

const clean = { userId: 'u1', stage: 'CREATE' as const, title: 'Inspect a laptop', description: 'Check stock', ruleReason: undefined };

describe('ModerationService.screenTask', () => {
  it('lets clean content through and asks the AI only when the rules pass', async () => {
    const { service, ai, rows } = build({ flagged: false, categories: [] });
    await expect(service.screenTask(clean)).resolves.toBeUndefined();
    expect(ai.classify).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(0);
  });

  it('blocks on a rule hit without spending an AI call, and starts a five-minute cooldown', async () => {
    const { service, ai, rows } = build();
    const error = await service.screenTask({ ...clean, ruleReason: 'weapons' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TaskBlockedError);
    expect((error as TaskBlockedError).details).toMatchObject({ eventId: 'evt-1', reason: 'weapons', retryAfterSeconds: 300 });
    expect(ai.classify).not.toHaveBeenCalled();
    const until = must(rows[0]).restrictedUntil.getTime() - Date.now();
    expect(until).toBeGreaterThan(290_000);
    expect(until).toBeLessThanOrEqual(300_000);
  });

  it('blocks what the AI flags, with a plain-language reason', async () => {
    const { service, rows } = build({ flagged: true, categories: ['violence', 'harassment/threatening'] });
    await expect(service.screenTask(clean)).rejects.toThrow(TaskBlockedError);
    expect(rows[0]).toMatchObject({ source: 'AI', reason: 'violence, harassment or threats' });
  });

  it('refuses every attempt inside the cooldown, clean or not', async () => {
    const { service, ai } = build();
    await service.screenTask({ ...clean, ruleReason: 'weapons' }).catch(() => undefined);
    await expect(service.screenTask(clean)).rejects.toThrow(PostingRestrictedError);
    expect(ai.classify).not.toHaveBeenCalled();
  });

  it('lets through exactly the content an admin overturned, even if a rule still matches it', async () => {
    const { service, rows } = build();
    await service.screenTask({ ...clean, ruleReason: 'weapons' }).catch(() => undefined);
    Object.assign(must(rows[0]), { appealStatus: 'OVERTURNED', restrictedUntil: new Date() });
    await expect(service.screenTask({ ...clean, ruleReason: 'weapons' })).resolves.toBeUndefined();
    // A different text is still judged on its own.
    await expect(service.screenTask({ ...clean, description: 'Other text', ruleReason: 'weapons' })).rejects.toThrow(
      TaskBlockedError,
    );
  });
});

describe('appeals', () => {
  it('lets the user request one review, and an overturn lifts the cooldown at once', async () => {
    const { service, rows, audit, notifications } = build();
    await service.screenTask({ ...clean, ruleReason: 'weapons' }).catch(() => undefined);

    await service.appeal('evt-1', 'u1', 'This is a glue gun at a hardware store.');
    await expect(service.appeal('evt-1', 'u1', 'Asking a second time')).rejects.toThrow(ConflictError);
    expect(must(rows[0]).appealStatus).toBe('PENDING');

    await service.decide('evt-1', 'admin-1', { decision: 'OVERTURN', note: 'Hardware item' });
    expect(must(rows[0]).appealStatus).toBe('OVERTURNED');
    expect(must(rows[0]).restrictedUntil.getTime()).toBeLessThanOrEqual(Date.now());
    await expect(service.assertNotRestricted('u1')).resolves.toBeUndefined();
    expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'MODERATION_OVERTURNED' }));
    expect(notifications.notify).toHaveBeenCalledWith('u1', expect.objectContaining({ overturned: true }));
  });

  it('does not let anyone else appeal the decision', async () => {
    const { service } = build();
    await service.screenTask({ ...clean, ruleReason: 'weapons' }).catch(() => undefined);
    await expect(service.appeal('evt-1', 'someone-else', 'Not mine but I want it gone')).rejects.toThrow(
      'That moderation decision was not found.',
    );
  });
});

describe('helpers', () => {
  it('hashes content so retyped whitespace or case does not count as new', () => {
    expect(hashContent('Inspect  a laptop', 'Check stock')).toBe(hashContent('inspect a laptop ', 'CHECK STOCK'));
    expect(hashContent('Inspect a laptop', 'Check stock')).not.toBe(hashContent('Inspect a laptop', 'Check the stock'));
  });

  it('describes AI categories in plain language', () => {
    expect(describeAiCategories(['illicit/violent'])).toBe('illegal activity');
    expect(describeAiCategories([])).toBe('content that breaks our rules');
  });
});
