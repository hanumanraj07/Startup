-- PostGIS spatial layer.
--
-- Hand written, because Prisma has no geography type and cannot express any of
-- this. The preceding init migration created the geography columns as plain
-- nullable columns; this migration replaces them with STORED generated columns
-- derived from the latitude and longitude that Prisma does write, then adds the
-- GIST and partial indexes the matching queries depend on.
--
-- Why generated rather than written by application code: the geography can
-- then never drift from the latitude and longitude it is derived from. There is
-- no code path, including a raw SQL insert or a manual fix in psql, that can
-- set one without the other. See docs/06-database-design.md.

-- ─────────────────────────────────────────────────────────────────────────
-- Geography columns, derived from lat/lng
--
-- ST_MakePoint takes longitude first. Getting that argument order wrong is the
-- classic PostGIS bug and it fails silently: points land in the wrong
-- hemisphere and every distance is wrong. The seed data asserts known
-- distances specifically to catch it.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "users" DROP COLUMN "home_geog";
ALTER TABLE "users" ADD COLUMN "home_geog" geography(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("home_lng", "home_lat"), 4326)::geography
  ) STORED;

ALTER TABLE "worker_profiles" DROP COLUMN "base_geog";
ALTER TABLE "worker_profiles" ADD COLUMN "base_geog" geography(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("base_lng", "base_lat"), 4326)::geography
  ) STORED;

ALTER TABLE "cities" DROP COLUMN "center_geog";
ALTER TABLE "cities" ADD COLUMN "center_geog" geography(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("center_lng", "center_lat"), 4326)::geography
  ) STORED;

ALTER TABLE "tasks" DROP COLUMN "task_geog";
ALTER TABLE "tasks" ADD COLUMN "task_geog" geography(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("task_lng", "task_lat"), 4326)::geography
  ) STORED;

-- PRIVATE. Never exposed to a worker, never an input to matching.
ALTER TABLE "tasks" DROP COLUMN "requester_geog";
ALTER TABLE "tasks" ADD COLUMN "requester_geog" geography(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("requester_lng", "requester_lat"), 4326)::geography
  ) STORED;

ALTER TABLE "arrival_records" DROP COLUMN "reported_geog";
ALTER TABLE "arrival_records" ADD COLUMN "reported_geog" geography(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("reported_lng", "reported_lat"), 4326)::geography
  ) STORED;

ALTER TABLE "task_proofs" DROP COLUMN "reported_geog";
ALTER TABLE "task_proofs" ADD COLUMN "reported_geog" geography(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("reported_lng", "reported_lat"), 4326)::geography
  ) STORED;

-- ─────────────────────────────────────────────────────────────────────────
-- Spatial indexes
--
-- Without these, ST_DWithin degrades from milliseconds to seconds as supply
-- grows, which is exactly when the marketplace starts working.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX "worker_profiles_base_geog_gix" ON "worker_profiles" USING GIST ("base_geog");
CREATE INDEX "tasks_task_geog_gix" ON "tasks" USING GIST ("task_geog");

-- ─────────────────────────────────────────────────────────────────────────
-- Partial indexes for the hot paths
--
-- Partial rather than full: the worker feed only ever looks at open tasks, and
-- the sweepers only ever look at one status each. Keeping the indexes small
-- keeps them in cache.
-- ─────────────────────────────────────────────────────────────────────────

-- The worker feed. Only open, unassigned tasks are ever scanned.
CREATE INDEX "tasks_open_feed_ix" ON "tasks" ("deadline_at")
  WHERE "status" IN ('PUBLISHED', 'MATCHING') AND "assigned_worker_id" IS NULL;

-- The auto-approval sweeper. This is the index that keeps workers paid when
-- Redis loses a delayed job. See docs/09-task-lifecycle.md.
CREATE INDEX "tasks_review_deadline_ix" ON "tasks" ("review_deadline_at")
  WHERE "status" = 'SUBMITTED';

-- The expiry sweeper.
CREATE INDEX "tasks_expiry_ix" ON "tasks" ("deadline_at")
  WHERE "status" IN ('PUBLISHED', 'MATCHING');

-- The stuck-payout sweeper.
CREATE INDEX "payouts_stuck_ix" ON "payouts" ("updated_at")
  WHERE "status" IN ('PENDING', 'PROCESSING');

-- ─────────────────────────────────────────────────────────────────────────
-- Ledger reconciliation
--
-- A CHECK constraint cannot span rows, so the zero-sum invariant is enforced
-- by tests and by a periodic reconciliation job. This view is what both of
-- them read, and what the admin console surfaces as an incident.
-- See docs/11-payment-flow.md.
-- ─────────────────────────────────────────────────────────────────────────

CREATE VIEW "unbalanced_tasks" AS
SELECT
  "task_id",
  SUM("amount_paise")            AS "imbalance_paise",
  COUNT(*)                       AS "entry_count",
  MAX("created_at")              AS "last_entry_at"
FROM "ledger_entries"
WHERE "task_id" IS NOT NULL
GROUP BY "task_id"
HAVING SUM("amount_paise") <> 0;

COMMENT ON VIEW "unbalanced_tasks" IS
  'Every task whose ledger entries do not sum to zero. Must always be empty. A non-empty result is an incident, not a warning.';
