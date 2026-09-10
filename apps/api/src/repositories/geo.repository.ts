import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * The ONLY place raw PostGIS SQL is permitted in this codebase.
 *
 * Prisma has no geography type, so spatial queries must use $queryRaw. That is
 * acceptable contained and dangerous scattered, so everything spatial lives
 * here behind typed wrappers and nothing else writes raw spatial SQL.
 * See ai/architecture-rules.md.
 *
 * Two rules hold throughout:
 *
 *  1. Every value is parameterized through Prisma.sql tagged templates. String
 *     interpolation into SQL is forbidden here as everywhere else, and the
 *     exemption for raw SQL does not extend to it.
 *
 *  2. ST_MakePoint takes LONGITUDE FIRST. Reversing it fails silently: points
 *     land in the wrong hemisphere and every distance is wrong but plausible.
 *     The seed asserts known distances specifically to catch this.
 *
 * Casts are ::text, not ::uuid. Prisma maps a `String @id` to a Postgres `text`
 * column unless it is explicitly annotated `@db.Uuid`, so casting an id to uuid
 * here fails with "operator does not exist: text = uuid". Native uuid columns
 * would be more compact and index slightly better, but at this scale the
 * difference is immaterial and the migration is not worth it. Recorded in
 * ai/memory.md so it is not rediscovered the hard way.
 */

export interface NearbyWorker {
  userId: string;
  workerProfileId: string;
  distanceMeters: number;
  ratingAvg: number | null;
  ratingCount: number;
  tasksCompleted: number;
  completionRate: number | null;
  responseRate: number | null;
  verificationLevel: number;
  lastActiveAt: Date | null;
  /** Completed tasks in THIS task's category specifically, for the matching
   *  engine's category-experience score. See docs/10-matching-engine.md. */
  categoryTasksCompleted: number;
}

export interface NearbyTask {
  id: string;
  distanceMeters: number;
  deadlineAt: Date;
  workerPayoutPaise: bigint;
}

export interface DistanceMeasurement {
  distanceMeters: number;
  isWithinGeofence: boolean;
}

/** Radius within which an arrival counts as being at the task location. */
export const DEFAULT_GEOFENCE_METERS = 150;

@Injectable()
export class GeoRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Workers eligible for a task, nearest first.
   *
   * Note the two radius conditions. The first is the task's current search
   * tier; the second is the worker's own declared working radius. A worker who
   * will not travel 12 km should never be offered a task 12 km away, and
   * ignoring their preference is how a marketplace trains people to disable
   * notifications.
   *
   * Ranking is NOT done here. This returns the eligible set with the signals
   * the matching engine needs; scoring lives in the matching module so the
   * formula stays testable without a database.
   */
  async findNearbyWorkers(params: {
    taskLat: number;
    taskLng: number;
    radiusMeters: number;
    minVerificationLevel: number;
    categoryId: string;
    excludeUserIds: string[];
    maxConcurrentTasks: number;
    limit: number;
  }): Promise<NearbyWorker[]> {
    const {
      taskLat,
      taskLng,
      radiusMeters,
      minVerificationLevel,
      categoryId,
      excludeUserIds,
      maxConcurrentTasks,
      limit,
    } = params;

    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${taskLng}, ${taskLat}), 4326)::geography`;

    return this.prisma.$queryRaw<NearbyWorker[]>`
      SELECT
        u.id                          AS "userId",
        wp.id                         AS "workerProfileId",
        ST_Distance(wp.base_geog, ${point})::float8 AS "distanceMeters",
        wp.rating_avg                 AS "ratingAvg",
        wp.rating_count               AS "ratingCount",
        wp.tasks_completed            AS "tasksCompleted",
        wp.completion_rate            AS "completionRate",
        wp.response_rate              AS "responseRate",
        u.verification_level          AS "verificationLevel",
        wp.last_active_at             AS "lastActiveAt",
        (
          SELECT COUNT(*) FROM tasks t
          WHERE t.assigned_worker_id = u.id
            AND t.category_id = ${categoryId}::text
            AND t.status IN ('COMPLETED','PAYMENT_RELEASED')
        )::int AS "categoryTasksCompleted"
      FROM worker_profiles wp
      JOIN users u ON u.id = wp.user_id
      JOIN worker_categories wc
        ON wc.worker_profile_id = wp.id
       AND wc.category_id = ${categoryId}::text
      WHERE wp.is_available = true
        AND u.status = 'ACTIVE'
        AND u.verification_level >= ${minVerificationLevel}
        -- The task's current search tier.
        AND ST_DWithin(wp.base_geog, ${point}, ${radiusMeters})
        -- The worker's own declared limit.
        AND ST_DWithin(wp.base_geog, ${point}, wp.working_radius_m)
        -- = ANY on a single array parameter, rather than an IN list built from
        -- many parameters: it needs no empty-array special case, and the cast
        -- lands on the array instead of on each element.
        AND NOT (u.id = ANY(${excludeUserIds}::text[]))
        -- Breadth of supply: a worker holding several tasks completes few well.
        AND (
          SELECT COUNT(*) FROM tasks t
          WHERE t.assigned_worker_id = u.id
            AND t.status IN ('ASSIGNED','WORKER_EN_ROUTE','ARRIVED','IN_PROGRESS')
        ) < ${maxConcurrentTasks}
      ORDER BY "distanceMeters" ASC
      LIMIT ${limit}
    `;
  }

  /**
   * The worker feed: open tasks near a worker, nearest first.
   *
   * Uses the tasks_open_feed_ix partial index and the tasks_task_geog_gix GIST
   * index. Both are asserted by an EXPLAIN test, because an unindexed version
   * of this query works perfectly in development and degrades badly in
   * production.
   */
  async findNearbyTasks(params: {
    workerLat: number;
    workerLng: number;
    radiusMeters: number;
    verificationLevel: number;
    categoryIds: string[];
    excludeRequesterIds: string[];
    limit: number;
    offset: number;
  }): Promise<NearbyTask[]> {
    const {
      workerLat,
      workerLng,
      radiusMeters,
      verificationLevel,
      categoryIds,
      excludeRequesterIds,
      limit,
      offset,
    } = params;

    if (categoryIds.length === 0) return [];

    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${workerLng}, ${workerLat}), 4326)::geography`;

    return this.prisma.$queryRaw<NearbyTask[]>`
      SELECT
        t.id,
        ST_Distance(t.task_geog, ${point})::float8 AS "distanceMeters",
        t.deadline_at          AS "deadlineAt",
        t.worker_payout_paise  AS "workerPayoutPaise"
      FROM tasks t
      WHERE t.status IN ('PUBLISHED','MATCHING')
        AND t.assigned_worker_id IS NULL
        AND t.deadline_at > now()
        AND t.min_verification_level <= ${verificationLevel}
        AND t.category_id = ANY(${categoryIds}::text[])
        AND ST_DWithin(t.task_geog, ${point}, ${radiusMeters})
        AND NOT (t.requester_id = ANY(${excludeRequesterIds}::text[]))
      ORDER BY "distanceMeters" ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  /**
   * Measures a reported coordinate against a task's location.
   *
   * This is the server-side check that makes client GPS evidence rather than
   * fact. The client never supplies a distance and is never believed about one.
   *
   * A result outside the geofence does NOT block anything. It is recorded and
   * surfaced. Mapped shop pins are routinely wrong by 50 metres or more, and
   * blocking the worker would punish them for the map's error.
   * See docs/09-task-lifecycle.md.
   */
  async measureDistanceToTask(params: {
    taskId: string;
    reportedLat: number;
    reportedLng: number;
    geofenceMeters?: number;
  }): Promise<DistanceMeasurement | null> {
    const { taskId, reportedLat, reportedLng } = params;
    const geofence = params.geofenceMeters ?? DEFAULT_GEOFENCE_METERS;

    const rows = await this.prisma.$queryRaw<{ distanceMeters: number }[]>`
      SELECT ST_Distance(
        t.task_geog,
        ST_SetSRID(ST_MakePoint(${reportedLng}, ${reportedLat}), 4326)::geography
      )::float8 AS "distanceMeters"
      FROM tasks t
      WHERE t.id = ${taskId}::text
    `;

    const row = rows[0];
    if (!row) return null;

    return {
      distanceMeters: row.distanceMeters,
      isWithinGeofence: row.distanceMeters <= geofence,
    };
  }

  /** Distance between two arbitrary points, in metres. Used by tests and admin tooling. */
  async distanceBetween(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ meters: number }[]>`
      SELECT ST_Distance(
        ST_SetSRID(ST_MakePoint(${a.lng}, ${a.lat}), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${b.lng}, ${b.lat}), 4326)::geography
      )::float8 AS meters
    `;
    return rows[0]?.meters ?? Number.NaN;
  }

  /**
   * The active city containing a point, or null if it falls outside the launch
   * area. Enforcing the launch scope in data rather than in scattered
   * conditionals means widening it is an admin action, not a deploy.
   */
  async findContainingCity(lat: number, lng: number): Promise<{ id: string; name: string } | null> {
    const rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>`
      SELECT c.id, c.name
      FROM cities c
      WHERE c.is_active = true
        AND ST_DWithin(
          c.center_geog,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
          c.radius_m
        )
      ORDER BY ST_Distance(
        c.center_geog,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      ) ASC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /**
   * Tasks whose ledger entries do not sum to zero.
   *
   * Must always return nothing. A non-empty result is an incident, not a
   * warning. Read by the reconciliation job, the admin console, and the
   * lifecycle soak test.
   */
  async findUnbalancedTasks(): Promise<
    { taskId: string; imbalancePaise: bigint; entryCount: bigint }[]
  > {
    return this.prisma.$queryRaw`
      SELECT
        task_id         AS "taskId",
        imbalance_paise AS "imbalancePaise",
        entry_count     AS "entryCount"
      FROM unbalanced_tasks
    `;
  }
}
