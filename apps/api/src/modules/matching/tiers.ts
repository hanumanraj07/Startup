/**
 * Radius-tier bookkeeping: how many workers each tier offers to, and how long
 * a tier waits before expanding. Pure and database-free, like scoring.ts.
 * See docs/10-matching-engine.md.
 */

/** Workers offered per tier, in tier order. The final tier is uncapped ("all eligible"). */
export const TIER_OFFER_COUNTS: readonly number[] = [10, 15, 25, Number.POSITIVE_INFINITY];

const FALLBACK_OFFER_COUNT = TIER_OFFER_COUNTS[TIER_OFFER_COUNTS.length - 1] ?? Number.POSITIVE_INFINITY;

export function offerCountForTier(tierIndex: number): number {
  return TIER_OFFER_COUNTS[tierIndex] ?? FALLBACK_OFFER_COUNT;
}

/**
 * The delay before advancing from `tierIndex` to `tierIndex + 1`, in
 * milliseconds.
 *
 * `waitMinutes` is `MATCH_TIER_RADII_M`'s companion array (env
 * `MATCH_TIER_WAIT_MINUTES`), one entry shorter than the radii list — there is
 * no wait after the final tier, which holds until the deadline instead.
 *
 * Compresses automatically for a near deadline: a task due in 45 minutes must
 * not spend the full configured 10 minutes waiting in tier 1 and then have no
 * time left for tiers 2 and 3. Every remaining wait is scaled down by the same
 * factor, so the schedule always finishes at or before the deadline rather
 * than running out of tiers before it runs out of time.
 */
export function computeTierDelayMs(params: {
  tierIndex: number;
  waitMinutes: readonly number[];
  deadlineAt: Date;
  now: Date;
}): number {
  const { tierIndex, waitMinutes, deadlineAt, now } = params;
  const currentWaitMinutes = tierIndex >= 0 ? waitMinutes[tierIndex] : undefined;
  if (currentWaitMinutes === undefined) return 0;

  const remaining = waitMinutes.slice(tierIndex);
  const remainingPlannedMs = remaining.reduce((sum, m) => sum + m, 0) * 60_000;
  const timeUntilDeadlineMs = Math.max(0, deadlineAt.getTime() - now.getTime());

  if (remainingPlannedMs <= timeUntilDeadlineMs) {
    return currentWaitMinutes * 60_000;
  }

  const scale = timeUntilDeadlineMs / remainingPlannedMs;
  return Math.max(0, Math.round(currentWaitMinutes * 60_000 * scale));
}
