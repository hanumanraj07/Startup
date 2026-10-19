-- Pickup & delivery tasks: a category decides whether its tasks happen at one
-- place or are a pickup and a drop-off; a task stores the drop-off point.
-- Decided 2026-10-18 (ai/memory.md). The task location stays the pickup point
-- and the only matching input.

-- CreateEnum
CREATE TYPE "LocationMode" AS ENUM ('SINGLE', 'PICKUP_DROPOFF');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN "location_mode" "LocationMode" NOT NULL DEFAULT 'SINGLE';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "dropoff_lat" DOUBLE PRECISION,
ADD COLUMN "dropoff_lng" DOUBLE PRECISION,
ADD COLUMN "dropoff_address" TEXT,
ADD COLUMN "dropoff_place_name" TEXT;

-- Hand-edited: like every geography column here, generated from the
-- coordinates so it can never drift from them (ai/memory.md, 2026-09-07).
-- Null whenever the drop-off coordinates are null. Not indexed: it is only
-- measured against, never searched by.
ALTER TABLE "tasks" ADD COLUMN "dropoff_geog" geography(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("dropoff_lng", "dropoff_lat"), 4326)::geography
  ) STORED;

-- A drop-off is all or nothing.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dropoff_complete_ck"
  CHECK ((dropoff_lat IS NULL) = (dropoff_lng IS NULL) AND (dropoff_lat IS NULL) = (dropoff_address IS NULL));

-- The first pickup & delivery category, so a fresh production database gets
-- it with the migration rather than waiting on a seed. Skipped if it exists.
INSERT INTO "categories" ("id", "slug", "name", "description", "icon", "default_proof_requirements",
  "suggested_min_paise", "suggested_max_paise", "is_active", "location_mode")
VALUES (
  gen_random_uuid()::text,
  'pickup-delivery',
  'Pickup & delivery',
  'Collect something from one place and hand it over at another.',
  'package',
  '[{"type":"PHOTO","label":"The item at pickup","required":true},{"type":"PHOTO","label":"The item handed over at the drop-off","required":true},{"type":"NOTE","label":"Who received it","required":true}]'::jsonb,
  20000,
  80000,
  true,
  'PICKUP_DROPOFF'
)
ON CONFLICT ("slug") DO NOTHING;
