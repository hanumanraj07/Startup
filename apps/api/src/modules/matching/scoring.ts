/**
 * The match score. Deliberately a transparent weighted formula rather than a
 * model — it can be explained to a worker who asks why they are ranked low,
 * and debugged when it misbehaves. There is no data to learn from yet.
 * See docs/10-matching-engine.md.
 *
 * Pure and database-free by design, exactly like transitions.ts and
 * risk.service.ts: every input the formula needs is a plain value, so the
 * entire scoring surface — cold start, diminishing returns, tie-breaks — is
 * testable without a database or a queue.
 */

export const SCORE_WEIGHTS = {
  proximity: 30,
  rating: 25,
  completionRate: 20,
  categoryExperience: 12,
  responseRate: 8,
  recency: 5,
} as const;

/** Below this many ratings, a worker sits at the platform mean rather than at zero. docs/10. */
export const MIN_RATINGS_FOR_OWN_SCORE = 5;

/** Category completions above this stop adding score — "diminishing returns above roughly 20". docs/10. */
export const CATEGORY_EXPERIENCE_CAP = 20;

/** Below this many completed tasks (any category), a worker counts as new for the boost below. */
export const NEW_WORKER_THRESHOLD = 5;

/** The "small explicit new-worker boost within the nearest tier" from docs/10's cold-start note. */
export const NEW_WORKER_BOOST = 5;

const RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ScoringCandidate {
  distanceMeters: number;
  /** Out of 5. */
  ratingAvg: number | null;
  ratingCount: number;
  /** Percentage, 0-100 — the same scale ReviewService.bumpWorkerCompletionStats writes. */
  completionRate: number | null;
  /** Completions in the task's own category specifically. */
  categoryTasksCompleted: number;
  /** Percentage, 0-100. Not written by anything yet (Phase 8); always null until then. */
  responseRate: number | null;
  /** Completions across every category — the signal for "is this worker new". */
  tasksCompleted: number;
  lastActiveAt: Date | null;
}

export interface PlatformMeans {
  /** Out of 5. */
  ratingAvg: number;
  /** Percentage, 0-100. */
  completionRate: number;
  /** Percentage, 0-100. */
  responseRate: number;
}

export interface ScoringContext {
  /** The current tier's radius — proximity decays linearly across exactly this, not the task's eventual maximum. */
  tierRadiusMeters: number;
  platformMeans: PlatformMeans;
  now: Date;
  /** Whether this is tier 0 (0-3km) — the only tier the new-worker boost applies in. */
  isNearestTier: boolean;
}

export interface ScoreBreakdown {
  proximity: number;
  rating: number;
  completionRate: number;
  categoryExperience: number;
  responseRate: number;
  recency: number;
  newWorkerBoost: number;
  /** Sum of the above, clamped to [0, 100]. */
  total: number;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function scoreCandidate(candidate: ScoringCandidate, ctx: ScoringContext): ScoreBreakdown {
  const proximityFraction =
    ctx.tierRadiusMeters > 0 ? clamp01(1 - candidate.distanceMeters / ctx.tierRadiusMeters) : 0;
  const proximity = proximityFraction * SCORE_WEIGHTS.proximity;

  const hasOwnRating = candidate.ratingCount >= MIN_RATINGS_FOR_OWN_SCORE && candidate.ratingAvg !== null;
  const ratingFraction = clamp01(
    (hasOwnRating && candidate.ratingAvg !== null ? candidate.ratingAvg : ctx.platformMeans.ratingAvg) / 5,
  );
  const rating = ratingFraction * SCORE_WEIGHTS.rating;

  const completionFraction = clamp01(
    (candidate.completionRate ?? ctx.platformMeans.completionRate) / 100,
  );
  const completionRate = completionFraction * SCORE_WEIGHTS.completionRate;

  const categoryFraction = clamp01(candidate.categoryTasksCompleted / CATEGORY_EXPERIENCE_CAP);
  const categoryExperience = categoryFraction * SCORE_WEIGHTS.categoryExperience;

  const responseFraction = clamp01((candidate.responseRate ?? ctx.platformMeans.responseRate) / 100);
  const responseRate = responseFraction * SCORE_WEIGHTS.responseRate;

  const isRecent =
    candidate.lastActiveAt !== null && ctx.now.getTime() - candidate.lastActiveAt.getTime() <= RECENCY_WINDOW_MS;
  const recency = isRecent ? SCORE_WEIGHTS.recency : 0;

  const isNewWorker = candidate.tasksCompleted < NEW_WORKER_THRESHOLD;
  const newWorkerBoost = ctx.isNearestTier && isNewWorker ? NEW_WORKER_BOOST : 0;

  const total = Math.max(
    0,
    Math.min(100, proximity + rating + completionRate + categoryExperience + responseRate + recency + newWorkerBoost),
  );

  return { proximity, rating, completionRate, categoryExperience, responseRate, recency, newWorkerBoost, total };
}

export interface RankableCandidate {
  score: number;
  distanceMeters: number;
  lastActiveAt: Date | null;
}

/**
 * Sort order for the ranked offer list: highest score first; ties broken by
 * proximity, then by EARLIER last_active_at (docs/10, verbatim). That last
 * rule reads backwards next to the recency score component, but the two serve
 * different purposes — recency rewards workers who are online right now,
 * while this tie-break spreads opportunity toward whoever has gone longest
 * without being offered work, among candidates the score already judged
 * equally good.
 */
export function compareCandidates(a: RankableCandidate, b: RankableCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
  const aTime = a.lastActiveAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = b.lastActiveAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return aTime - bTime;
}
