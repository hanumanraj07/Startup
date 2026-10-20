-- docs/22, #4: refunds were bookkeeping only. Every credit to the ledger's
-- REFUND account now writes a refund row in the same transaction (an outbox),
-- and the sweeper sends it to the payment gateway. One row is one gateway
-- refund against one captured payment: the task's own, or an item top-up.

CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- The top-up's own gateway payment, so its money can be refunded against it.
ALTER TABLE "item_purchases" ADD COLUMN "top_up_gateway_payment_id" TEXT;
CREATE UNIQUE INDEX "item_purchases_top_up_gateway_payment_id_key" ON "item_purchases"("top_up_gateway_payment_id");

CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "item_purchase_id" TEXT,
    "gateway" "PaymentGateway" NOT NULL,
    "gateway_payment_id" TEXT,
    "gateway_refund_id" TEXT,
    "amount_paise" BIGINT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failure_reason" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_amount_positive" CHECK ("amount_paise" > 0),
    -- Refunded against exactly one source.
    CONSTRAINT "refunds_one_source" CHECK (("payment_id" IS NULL) <> ("item_purchase_id" IS NULL))
);

CREATE UNIQUE INDEX "refunds_gateway_refund_id_key" ON "refunds"("gateway_refund_id");
CREATE INDEX "refunds_status_next_attempt_at_idx" ON "refunds"("status", "next_attempt_at");
CREATE INDEX "refunds_task_id_idx" ON "refunds"("task_id");

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_item_purchase_id_fkey" FOREIGN KEY ("item_purchase_id") REFERENCES "item_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
