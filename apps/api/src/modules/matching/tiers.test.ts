import { describe, expect, it } from 'vitest';
import { TIER_OFFER_COUNTS, computeTierDelayMs, offerCountForTier } from './tiers';

const WAITS = [10, 15, 20]; // minutes, matching the documented default MATCH_TIER_WAIT_MINUTES

describe('offerCountForTier', () => {
  it('returns the documented count for each tier', () => {
    expect(offerCountForTier(0)).toBe(10);
    expect(offerCountForTier(1)).toBe(15);
    expect(offerCountForTier(2)).toBe(25);
  });

  it('is uncapped at the final tier', () => {
    expect(offerCountForTier(3)).toBe(Number.POSITIVE_INFINITY);
  });

  it('falls back to the last configured count for an out-of-range tier', () => {
    expect(offerCountForTier(99)).toBe(TIER_OFFER_COUNTS[TIER_OFFER_COUNTS.length - 1]);
  });
});

describe('computeTierDelayMs', () => {
  it('uses the full configured wait when there is plenty of time before the deadline', () => {
    const now = new Date('2026-09-07T12:00:00.000Z');
    const deadlineAt = new Date('2026-09-08T12:00:00.000Z'); // 24h away
    const delay = computeTierDelayMs({ tierIndex: 0, waitMinutes: WAITS, deadlineAt, now });
    expect(delay).toBe(10 * 60_000);
  });

  it('returns zero once past the last waited tier', () => {
    const now = new Date('2026-09-07T12:00:00.000Z');
    const deadlineAt = new Date('2026-09-08T12:00:00.000Z');
    expect(computeTierDelayMs({ tierIndex: WAITS.length, waitMinutes: WAITS, deadlineAt, now })).toBe(0);
    expect(computeTierDelayMs({ tierIndex: 99, waitMinutes: WAITS, deadlineAt, now })).toBe(0);
  });

  it('compresses proportionally when the deadline is nearer than the planned schedule', () => {
    const now = new Date('2026-09-07T12:00:00.000Z');
    // Only 22.5 minutes left, half of the planned 45 (10+15+20).
    const deadlineAt = new Date(now.getTime() + 22.5 * 60_000);
    const delay = computeTierDelayMs({ tierIndex: 0, waitMinutes: WAITS, deadlineAt, now });
    expect(delay).toBe(5 * 60_000); // 10 minutes * 0.5
  });

  it('never returns a negative delay for a deadline already in the past', () => {
    const now = new Date('2026-09-07T12:00:00.000Z');
    const deadlineAt = new Date(now.getTime() - 60_000);
    const delay = computeTierDelayMs({ tierIndex: 0, waitMinutes: WAITS, deadlineAt, now });
    expect(delay).toBe(0);
  });

  it('keeps compressing consistently across successive tiers so the schedule still lands on time', () => {
    const now = new Date('2026-09-07T12:00:00.000Z');
    // Half the planned 45 minutes remain in total.
    const deadlineAt = new Date(now.getTime() + 22.5 * 60_000);

    const tier0Delay = computeTierDelayMs({ tierIndex: 0, waitMinutes: WAITS, deadlineAt, now });
    const afterTier0 = new Date(now.getTime() + tier0Delay);
    const tier1Delay = computeTierDelayMs({ tierIndex: 1, waitMinutes: WAITS, deadlineAt, now: afterTier0 });
    const afterTier1 = new Date(afterTier0.getTime() + tier1Delay);
    const tier2Delay = computeTierDelayMs({ tierIndex: 2, waitMinutes: WAITS, deadlineAt, now: afterTier1 });
    const afterTier2 = new Date(afterTier1.getTime() + tier2Delay);

    expect(afterTier2.getTime()).toBeLessThanOrEqual(deadlineAt.getTime());
  });
});
