-- docs/22, #27: files removed from the database (a worker's proofs when they
-- leave or delete one) were never removed from storage. The transaction that
-- removes the rows now queues their storage keys here; the retention job
-- deletes the objects.

CREATE TABLE "storage_deletions" (
    "id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_deletions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storage_deletions_storage_key_key" ON "storage_deletions"("storage_key");
CREATE INDEX "storage_deletions_pending_idx" ON "storage_deletions"("created_at") WHERE "deleted_at" IS NULL;
