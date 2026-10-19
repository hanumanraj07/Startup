-- AlterTable
ALTER TABLE "task_offers" ADD COLUMN     "expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "task_offers_expires_at_idx" ON "task_offers"("expires_at");
