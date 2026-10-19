-- P6: item purchases are approved before anything is paid. The worker sends
-- the bill from the shop; the requester approves the exact amount; the
-- platform pays the shop's UPI ID, or the worker pays cash (capped) and is
-- repaid at the handover. See docs/11-payment-flow.md.

CREATE TYPE "PayoutKind" AS ENUM ('EARNINGS', 'ITEM_REIMBURSEMENT');
CREATE TYPE "ItemPurchaseStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ItemPaymentMethod" AS ENUM ('SHOP_UPI', 'WORKER_CASH');

ALTER TYPE "LedgerAccount" ADD VALUE 'ITEM_PASS_THROUGH';
ALTER TYPE "LedgerAccount" ADD VALUE 'ITEM_REIMBURSABLE';

-- Top-ups: a bill above the budget is approved with the difference paid then.
ALTER TABLE "tasks" ADD COLUMN "item_top_up_paise" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_item_top_up_nonnegative" CHECK ("item_top_up_paise" >= 0);
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_item_spent_within_budget";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_item_spent_within_budget"
  CHECK ("item_spent_paise" IS NULL OR ("item_spent_paise" >= 0 AND "item_spent_paise" <= "item_budget_paise" + "item_top_up_paise"));

-- The handover code the requester gives the worker on receiving the item.
ALTER TABLE "tasks" ADD COLUMN "handover_code" TEXT;
ALTER TABLE "tasks" ADD COLUMN "handover_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN "handover_confirmed_at" TIMESTAMP(3);

-- A task may now owe a worker twice: the item reimbursement and earnings.
DROP INDEX "payouts_task_id_key";
CREATE INDEX "payouts_task_id_idx" ON "payouts"("task_id");
ALTER TABLE "payouts" ADD COLUMN "kind" "PayoutKind" NOT NULL DEFAULT 'EARNINGS';

CREATE TABLE "item_purchases" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "bill_storage_key" TEXT NOT NULL,
    "method" "ItemPaymentMethod" NOT NULL,
    "merchant_vpa" TEXT,
    "merchant_name" TEXT,
    "status" "ItemPurchaseStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "top_up_paise" BIGINT NOT NULL DEFAULT 0,
    "top_up_gateway" "PaymentGateway",
    "top_up_gateway_order_id" TEXT,
    "top_up_captured_at" TIMESTAMP(3),
    "shop_payment_status" "PayoutStatus",
    "shop_payment_reference" TEXT,
    "shop_payment_failure_reason" TEXT,
    "shop_payment_attempts" INTEGER NOT NULL DEFAULT 0,
    "spent_recorded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_purchases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "item_purchases_amount_positive" CHECK ("amount_paise" > 0),
    CONSTRAINT "item_purchases_top_up_within_amount" CHECK ("top_up_paise" >= 0 AND "top_up_paise" <= "amount_paise"),
    CONSTRAINT "item_purchases_shop_needs_vpa" CHECK ("method" <> 'SHOP_UPI' OR "merchant_vpa" IS NOT NULL)
);

CREATE UNIQUE INDEX "item_purchases_top_up_gateway_order_id_key" ON "item_purchases"("top_up_gateway_order_id");
CREATE INDEX "item_purchases_task_id_created_at_idx" ON "item_purchases"("task_id", "created_at");
-- The database, not application code, guarantees one approved bill and one
-- open bill per task at most.
CREATE UNIQUE INDEX "item_purchases_one_approved" ON "item_purchases"("task_id") WHERE "status" = 'APPROVED';
CREATE UNIQUE INDEX "item_purchases_one_pending" ON "item_purchases"("task_id") WHERE "status" = 'PENDING_APPROVAL';

ALTER TABLE "item_purchases" ADD CONSTRAINT "item_purchases_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_purchases" ADD CONSTRAINT "item_purchases_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
