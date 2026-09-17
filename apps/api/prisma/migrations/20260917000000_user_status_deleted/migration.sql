-- Adds DELETED to UserStatus, for account deletion: the row is kept (PII
-- anonymized in place) rather than removed, since Task/Payment/Dispute rows
-- reference the user and must survive for financial/audit/legal reasons.
-- See UsersService.deleteAccount.
ALTER TYPE "UserStatus" ADD VALUE 'DELETED';
