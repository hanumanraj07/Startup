-- CreateEnum
CREATE TYPE "ReleaseInitiator" AS ENUM ('WORKER', 'REQUESTER');

-- CreateEnum
CREATE TYPE "ModerationSource" AS ENUM ('RULES', 'AI');

-- CreateEnum
CREATE TYPE "ModerationAppealStatus" AS ENUM ('NONE', 'PENDING', 'UPHELD', 'OVERTURNED');

-- CreateTable
CREATE TABLE "task_releases" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "initiated_by" "ReleaseInitiator" NOT NULL,
    "from_status" "TaskStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT,
    "stage" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "source" "ModerationSource" NOT NULL,
    "reason" TEXT NOT NULL,
    "categories" TEXT[],
    "restricted_until" TIMESTAMP(3) NOT NULL,
    "appeal_status" "ModerationAppealStatus" NOT NULL DEFAULT 'NONE',
    "appeal_note" TEXT,
    "appealed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_releases_task_id_idx" ON "task_releases"("task_id");

-- CreateIndex
CREATE INDEX "task_releases_worker_id_created_at_idx" ON "task_releases"("worker_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "moderation_events_user_id_created_at_idx" ON "moderation_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "moderation_events_appeal_status_created_at_idx" ON "moderation_events"("appeal_status", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "task_releases" ADD CONSTRAINT "task_releases_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_releases" ADD CONSTRAINT "task_releases_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
