-- Buying an item for the requester (pickup & delivery). Commission is never
-- taken on it: see packages/money calculateItemSettlement.
ALTER TABLE "tasks" ADD COLUMN "item_budget_paise" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN "item_spent_paise" BIGINT;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_item_budget_nonnegative" CHECK ("item_budget_paise" >= 0);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_item_spent_within_budget"
  CHECK ("item_spent_paise" IS NULL OR ("item_spent_paise" >= 0 AND "item_spent_paise" <= "item_budget_paise"));

-- The reimbursement part of a payout, kept apart from earnings.
ALTER TABLE "payouts" ADD COLUMN "reimbursement_paise" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_reimbursement_within_amount"
  CHECK ("reimbursement_paise" >= 0 AND "reimbursement_paise" <= "amount_paise");

-- Payout accounts: the holder's name, when it was verified, and soft removal.
ALTER TABLE "payout_accounts" ADD COLUMN "account_holder_name" TEXT;
ALTER TABLE "payout_accounts" ADD COLUMN "verified_at" TIMESTAMP(3);
ALTER TABLE "payout_accounts" ADD COLUMN "removed_at" TIMESTAMP(3);
