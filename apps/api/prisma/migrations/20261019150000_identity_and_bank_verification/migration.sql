-- Automated identity verification (DigiLocker via a provider) and bank or
-- UPI account verification with a name match. See ai/memory.md, P4.
CREATE TYPE "PayoutAccountVerification" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'NAME_MISMATCH');
CREATE TYPE "VerificationProviderName" AS ENUM ('MOCK', 'CASHFREE');
CREATE TYPE "IdentityVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'CONSENT_DENIED', 'EXPIRED', 'FAILED');

CREATE TABLE "identity_verifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "VerificationProviderName" NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'DIGILOCKER',
    "provider_reference" TEXT,
    "status" "IdentityVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verified_name" TEXT,
    "document_last4" TEXT,
    "failure_reason" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "identity_verifications_user_id_created_at_idx" ON "identity_verifications"("user_id", "created_at");
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payout_accounts" ADD COLUMN "account_number_encrypted" TEXT;
ALTER TABLE "payout_accounts" ADD COLUMN "verification_status" "PayoutAccountVerification" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "payout_accounts" ADD COLUMN "name_at_bank" TEXT;
ALTER TABLE "payout_accounts" ADD COLUMN "bank_name" TEXT;
ALTER TABLE "payout_accounts" ADD COLUMN "verification_reference" TEXT;
ALTER TABLE "payout_accounts" ADD COLUMN "verification_failure_reason" TEXT;

-- Accounts already marked verified (P3's test-mode shortcut) keep that status.
UPDATE "payout_accounts" SET "verification_status" = 'VERIFIED' WHERE "is_verified" = true;
