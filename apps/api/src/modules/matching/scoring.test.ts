import { describe, expect, it } from 'vitest';
import {
  CATEGORY_EXPERIENCE_CAP,
  MIN_RATINGS_FOR_OWN_SCORE,
  NEW_WORKER_BOOST,
  NEW_WORKER_THRESHOLD,
  SCORE_WEIGHTS,
  compareCandidates,
  scoreCandidate,
  type PlatformMeans,
  type ScoringCandidate,
} from './scoring';

const MEANS: PlatformMeans = { ratingAvg: 4.0, completionRate: 80, responseRate: 70 };
const NOW = new Date('2026-09-07T12:00:00.000Z');

function candidate(overrides: Partial<ScoringCandidate> = {}): ScoringCandidate {
  return {
    distanceMeters: 0,
    ratingAvg: 4.8,
    ratingCount: 20,
    completionRate: 95,
    categoryTasksCompleted: 10,
    responseRate: 90,
    tasksCompleted: 50,
    lastActiveAt: NOW,
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  it('gives a worker at the task location, with strong history, near the maximum score', () => {
    const result = scoreCandidate(candidate(), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: true,
    });
    expect(result.total).toBeGreaterThan(90);
    expect(result.total).toBeLessThanOrEqual(100);
  });

  it('decays proximity linearly across the tier radius', () => {
    const near = scoreCandidate(candidate({ distanceMeters: 0 }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    const half = scoreCandidate(candidate({ distanceMeters: 1500 }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    const edge = scoreCandidate(candidate({ distanceMeters: 3000 }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    expect(near.proximity).toBeCloseTo(SCORE_WEIGHTS.proximity, 5);
    expect(half.proximity).toBeCloseTo(SCORE_WEIGHTS.proximity / 2, 5);
    expect(edge.proximity).toBeCloseTo(0, 5);
  });

  it('never lets proximity go negative for a candidate beyond the tier radius', () => {
    const result = scoreCandidate(candidate({ distanceMeters: 5000 }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    expect(result.proximity).toBe(0);
  });

  it("is not decisive alone: docs/10's own founding example — 1km @ 3.8 rating/2 completions/72% loses to 2km @ 4.9/87 completions", () => {
    const near = scoreCandidate(
      candidate({
        distanceMeters: 1000,
        ratingAvg: 3.8,
        ratingCount: 2, // below the floor: this candidate's own rating does not even count yet
        completionRate: 72,
        categoryTasksCompleted: 2,
        tasksCompleted: 2,
      }),
      { tierRadiusMeters: 3000, platformMeans: MEANS, now: NOW, isNearestTier: true },
    );
    const far = scoreCandidate(
      candidate({
        distanceMeters: 2000,
        ratingAvg: 4.9,
        ratingCount: 87,
        completionRate: 95,
        categoryTasksCompleted: 87,
        tasksCompleted: 87,
      }),
      { tierRadiusMeters: 3000, platformMeans: MEANS, now: NOW, isNearestTier: true },
    );
    // The near candidate gets the new-worker boost AND the platform-mean
    // rating fallback (its own 3.8 doesn't count with only 2 ratings) and
    // still loses, because the far candidate's real history — a much better
    // rating, completion rate, and 87 completions in this exact category
    // against the near candidate's 2 — outweighs one extra kilometre.
    expect(far.total).toBeGreaterThan(near.total);
  });

  it('cold start: a worker below the ratings floor sits at the platform mean, not at zero', () => {
    const noHistory = scoreCandidate(candidate({ ratingAvg: null, ratingCount: 0 }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    expect(noHistory.rating).toBeCloseTo((MEANS.ratingAvg / 5) * SCORE_WEIGHTS.rating, 5);
  });

  it('cold start applies at exactly the ratings floor boundary', () => {
    const belowFloor = scoreCandidate(candidate({ ratingAvg: 5, ratingCount: MIN_RATINGS_FOR_OWN_SCORE - 1 }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    const atFloor = scoreCandidate(candidate({ ratingAvg: 5, ratingCount: MIN_RATINGS_FOR_OWN_SCORE }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    expect(belowFloor.rating).toBeCloseTo((MEANS.ratingAvg / 5) * SCORE_WEIGHTS.rating, 5);
    expect(atFloor.rating).toBeCloseTo((5 / 5) * SCORE_WEIGHTS.rating, 5);
  });

  it('null completionRate and responseRate fall back to the platform mean', () => {
    const result = scoreCandidate(candidate({ completionRate: null, responseRate: null }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    expect(result.completionRate).toBeCloseTo((MEANS.completionRate / 100) * SCORE_WEIGHTS.completionRate, 5);
    expect(result.responseRate).toBeCloseTo((MEANS.responseRate / 100) * SCORE_WEIGHTS.responseRate, 5);
  });

  it('category experience has diminishing returns above the cap', () => {
    const atCap = scoreCandidate(candidate({ categoryTasksCompleted: CATEGORY_EXPERIENCE_CAP }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    const wayAbove = scoreCandidate(candidate({ categoryTasksCompleted: CATEGORY_EXPERIENCE_CAP * 5 }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    expect(atCap.categoryExperience).toBeCloseTo(SCORE_WEIGHTS.categoryExperience, 5);
    expect(wayAbove.categoryExperience).toBeCloseTo(SCORE_WEIGHTS.categoryExperience, 5);
  });

  it('awards the recency component only within the last 24 hours', () => {
    const justInside = scoreCandidate(candidate({ lastActiveAt: new Date(NOW.getTime() - 23 * 60 * 60 * 1000) }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    const justOutside = scoreCandidate(candidate({ lastActiveAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    const never = scoreCandidate(candidate({ lastActiveAt: null }), {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    expect(justInside.recency).toBe(SCORE_WEIGHTS.recency);
    expect(justOutside.recency).toBe(0);
    expect(never.recency).toBe(0);
  });

  it('boosts a new worker only in the nearest tier', () => {
    const newWorker = candidate({ tasksCompleted: NEW_WORKER_THRESHOLD - 1 });
    const inNearestTier = scoreCandidate(newWorker, {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: true,
    });
    const inFartherTier = scoreCandidate(newWorker, {
      tierRadiusMeters: 7000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: false,
    });
    expect(inNearestTier.newWorkerBoost).toBe(NEW_WORKER_BOOST);
    expect(inFartherTier.newWorkerBoost).toBe(0);
  });

  it('does not boost an experienced worker even in the nearest tier', () => {
    const experienced = candidate({ tasksCompleted: NEW_WORKER_THRESHOLD + 1 });
    const result = scoreCandidate(experienced, {
      tierRadiusMeters: 3000,
      platformMeans: MEANS,
      now: NOW,
      isNearestTier: true,
    });
    expect(result.newWorkerBoost).toBe(0);
  });

  it('clamps the total to 100 even with the new-worker boost added on top', () => {
    const result = scoreCandidate(
      candidate({ distanceMeters: 0, tasksCompleted: 1, lastActiveAt: NOW }),
      { tierRadiusMeters: 3000, platformMeans: MEANS, now: NOW, isNearestTier: true },
    );
    expect(result.total).toBeLessThanOrEqual(100);
  });

  it('never returns a negative total for the worst possible candidate', () => {
    const result = scoreCandidate(
      candidate({
        distanceMeters: 100_000,
        ratingAvg: 0,
        ratingCount: 100,
        completionRate: 0,
        categoryTasksCompleted: 0,
        responseRate: 0,
        tasksCompleted: 100,
        lastActiveAt: null,
      }),
      { tierRadiusMeters: 3000, platformMeans: MEANS, now: NOW, isNearestTier: false },
    );
    expect(result.total).toBeGreaterThanOrEqual(0);
  });
});

describe('compareCandidates', () => {
  it('ranks the higher score first', () => {
    const a = { score: 80, distanceMeters: 100, lastActiveAt: NOW };
    const b = { score: 90, distanceMeters: 100, lastActiveAt: NOW };
    expect(compareCandidates(a, b)).toBeGreaterThan(0);
    expect(compareCandidates(b, a)).toBeLessThan(0);
  });

  it('breaks a tied score by proximity', () => {
    const near = { score: 80, distanceMeters: 100, lastActiveAt: NOW };
    const far = { score: 80, distanceMeters: 2000, lastActiveAt: NOW };
    expect(compareCandidates(near, far)).toBeLessThan(0);
  });

  it('breaks a tied score and distance by earlier last_active_at', () => {
    const earlier = { score: 80, distanceMeters: 100, lastActiveAt: new Date(NOW.getTime() - 60_000) };
    const later = { score: 80, distanceMeters: 100, lastActiveAt: NOW };
    expect(compareCandidates(earlier, later)).toBeLessThan(0);
  });

  it('treats a worker who has never been active as tied last, not first', () => {
    const active = { score: 80, distanceMeters: 100, lastActiveAt: NOW };
    const neverActive = { score: 80, distanceMeters: 100, lastActiveAt: null };
    expect(compareCandidates(active, neverActive)).toBeLessThan(0);
  });
});
