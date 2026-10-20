-- docs/22, #17: push and email were sent inside the request that triggered
-- them. The notification row is now also the outbox for its delivery: the
-- request writes it with the channels still to send, and the worker process
-- sends them, retrying, recording each channel once it has gone.

ALTER TABLE "notifications"
  ADD COLUMN "pending_channels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "push_sent_at" TIMESTAMP(3),
  ADD COLUMN "email_sent_at" TIMESTAMP(3),
  ADD COLUMN "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "delivery_claimed_at" TIMESTAMP(3),
  ADD COLUMN "delivered_at" TIMESTAMP(3),
  ADD COLUMN "delivery_error" TEXT;

-- Everything sent before this existed was delivered inline already.
UPDATE "notifications" SET "delivered_at" = "created_at";

-- The sweep for deliveries whose queued job was lost reads only these.
CREATE INDEX "notifications_undelivered_idx" ON "notifications"("created_at") WHERE "delivered_at" IS NULL;
