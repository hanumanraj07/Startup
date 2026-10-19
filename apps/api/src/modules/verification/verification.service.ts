import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { IdentityVerification, PayoutAccount, PayoutAccountVerification } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { EncryptionService } from '../../common/encryption.service';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../common/errors';
import { loadEnv, verificationProvider } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { compareNames, isAcceptableMatch } from './name-match';
import {
  ProviderUnavailableError,
  VERIFICATION_PROVIDER,
  type AccountCheck,
  type IdentityResult,
  type VerificationProvider,
} from './verification.provider';

/** Identity checks a user may start in 24 hours before being pointed to manual review. */
export const IDENTITY_ATTEMPTS_PER_DAY = 5;

export interface AccountDecision {
  status: PayoutAccountVerification;
  reason: string | null;
}

/**
 * What a provider's answer means for a payout account. Pure, so the rules are
 * tested directly: an unreachable provider never fails an account, an invalid
 * account never passes, and a valid one passes only when the name on it is
 * the verified person's.
 */
export function decideAccount(check: AccountCheck, expectedName: string): AccountDecision {
  if (check.outcome === 'UNAVAILABLE') return { status: 'PENDING', reason: check.reason };
  if (check.outcome === 'INVALID') return { status: 'FAILED', reason: check.reason ?? 'The account could not be verified.' };
  const match = check.providerNameMatch ?? (check.nameAtBank ? compareNames(check.nameAtBank, expectedName) : null);
  if (match === null) {
    return { status: 'PENDING', reason: 'The bank did not return the account holder’s name, so it needs a manual check.' };
  }
  if (!isAcceptableMatch(match)) {
    return {
      status: 'NAME_MISMATCH',
      reason: `The name on this account${check.nameAtBank ? ` (${check.nameAtBank})` : ''} does not match your verified name. Payouts can only go to an account in your own name.`,
    };
  }
  return { status: 'VERIFIED', reason: null };
}

/**
 * Identity verification through a provider (DigiLocker, consent-based) and
 * payout-account verification with a name match against that identity.
 *
 * Restrictions it supports (enforced where the features live):
 *   - adding a payout account needs a verified identity (level 2+)
 *   - payouts go only to a VERIFIED account (PayoutsService)
 *
 * Kept from the provider's answer: the legal name and the last four digits of
 * the document. Never the document number, address, date of birth or photo.
 * The manual document upload (KYC submissions, admin-reviewed) remains the
 * fallback when there is no provider or the automated check keeps failing.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    @Optional() @Inject(VERIFICATION_PROVIDER) private readonly provider: VerificationProvider | null,
  ) {}

  // ─── Identity ─────────────────────────────────────────────────────────

  async status(userId: string) {
    const [user, latest, attempts, manual] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { verificationLevel: true } }),
      this.prisma.identityVerification.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.attemptsToday(userId),
      this.prisma.kycSubmission.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { status: true } }),
    ]);
    return {
      provider: verificationProvider(),
      verificationLevel: user.verificationLevel,
      identityVerified: user.verificationLevel >= 2,
      identity: latest ? this.identityView(latest) : null,
      manualStatus: manual?.status ?? null,
      attemptsLeftToday: Math.max(0, IDENTITY_ATTEMPTS_PER_DAY - attempts),
    };
  }

  /** Opens a DigiLocker consent session and returns where to send the user. */
  async startIdentity(userId: string) {
    const provider = this.requireProvider();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { verificationLevel: true } });
    if (user.verificationLevel >= 2) throw new ConflictError('Your identity is already verified.');
    if ((await this.attemptsToday(userId)) >= IDENTITY_ATTEMPTS_PER_DAY) {
      throw new BusinessRuleError(
        'Too many verification attempts today. Upload your documents for a manual check instead, or try again tomorrow.',
      );
    }

    const row = await this.prisma.identityVerification.create({
      data: { userId, provider: provider.name, expiresAt: new Date(Date.now() + 10 * 60_000) },
    });
    try {
      const session = await provider.startIdentity({
        verificationId: row.id,
        redirectUrl: `${loadEnv().WEB_URL}/kyc?session=${row.id}`,
      });
      await this.prisma.identityVerification.update({
        where: { id: row.id },
        data: { providerReference: session.providerReference, expiresAt: session.expiresAt },
      });
      return { sessionId: row.id, url: session.url, expiresAt: session.expiresAt.toISOString() };
    } catch (error) {
      await this.prisma.identityVerification.update({
        where: { id: row.id },
        data: { status: 'FAILED', failureReason: 'Could not reach DigiLocker.', completedAt: new Date() },
      });
      if (error instanceof ProviderUnavailableError) {
        throw new BusinessRuleError('DigiLocker could not be reached just now. Try again in a few minutes.');
      }
      throw error;
    }
  }

  /** Asks the provider where a session stands, and records the outcome once it is final. */
  async refreshIdentity(userId: string, sessionId: string) {
    const row = await this.ownSession(userId, sessionId);
    if (row.status !== 'PENDING') return this.identityView(row);
    const provider = this.requireProvider();

    let result: IdentityResult;
    try {
      result = await provider.identityResult({ verificationId: row.id });
    } catch (error) {
      if (error instanceof ProviderUnavailableError) return this.identityView(row);
      throw error;
    }
    if (result.status === 'PENDING' && row.expiresAt.getTime() < Date.now()) result = { status: 'EXPIRED' };
    return this.identityView(await this.apply(row, result));
  }

  /**
   * The mock provider's consent screen completes here, standing in for the
   * provider's callback. Refused (as not found) with any real provider.
   */
  async completeTestIdentity(userId: string, sessionId: string, input: { allow: boolean; name: string }) {
    if (this.provider?.name !== 'MOCK') throw new NotFoundError('Not found.');
    const row = await this.ownSession(userId, sessionId);
    if (row.status !== 'PENDING') return this.identityView(row);
    const result: IdentityResult = input.allow
      ? { status: 'VERIFIED', name: input.name.trim(), documentLast4: '0000' }
      : { status: 'CONSENT_DENIED' };
    return this.identityView(await this.apply(row, result));
  }

  /** The verified legal name, when an automated identity check has produced one. */
  async legalName(userId: string): Promise<string | null> {
    const row = await this.prisma.identityVerification.findFirst({
      where: { userId, status: 'VERIFIED' },
      orderBy: { completedAt: 'desc' },
      select: { verifiedName: true },
    });
    return row?.verifiedName ?? null;
  }

  private async apply(row: IdentityVerification, result: IdentityResult): Promise<IdentityVerification> {
    if (result.status === 'PENDING') return row;

    // Conditional on still being PENDING, so a poll and a callback racing
    // each other record the outcome once.
    const data =
      result.status === 'VERIFIED'
        ? { status: 'VERIFIED' as const, verifiedName: result.name, documentLast4: result.documentLast4 }
        : result.status === 'FAILED'
          ? { status: 'FAILED' as const, failureReason: result.reason }
          : { status: result.status };
    const updated = await this.prisma.identityVerification.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { ...data, completedAt: new Date() },
    });
    const fresh = await this.prisma.identityVerification.findUniqueOrThrow({ where: { id: row.id } });
    if (updated.count === 0 || result.status !== 'VERIFIED') return fresh;

    // Verified identity is level 2 (docs/12): the government record is the
    // check that the manual review approximates with a document photo.
    await this.prisma.user.updateMany({
      where: { id: row.userId, verificationLevel: { lt: 2 } },
      data: { verificationLevel: 2 },
    });
    await this.audit.record({
      actorUserId: row.userId,
      action: 'IDENTITY_VERIFIED',
      entityType: 'IdentityVerification',
      entityId: row.id,
      after: { provider: row.provider, method: row.method, documentLast4: result.documentLast4 },
    });
    try {
      await this.notifications.notify(row.userId, { event: 'KYC_APPROVED' });
    } catch (error) {
      this.logger.warn(`KYC_APPROVED notification failed for ${row.userId}: ${String(error)}`);
    }
    return fresh;
  }

  private identityView(row: IdentityVerification) {
    return {
      id: row.id,
      status: row.status,
      method: row.method,
      verifiedName: row.verifiedName,
      documentLast4: row.documentLast4,
      failureReason: row.failureReason,
      expiresAt: row.expiresAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  private async ownSession(userId: string, sessionId: string) {
    const row = await this.prisma.identityVerification.findFirst({ where: { id: sessionId, userId } });
    if (!row) throw new NotFoundError('Verification not found.');
    return row;
  }

  private attemptsToday(userId: string) {
    return this.prisma.identityVerification.count({
      where: { userId, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
    });
  }

  private requireProvider(): VerificationProvider {
    if (!this.provider) {
      throw new BusinessRuleError('Automatic verification is not available yet. Upload your documents for a manual check.');
    }
    return this.provider;
  }

  // ─── Payout accounts ──────────────────────────────────────────────────

  /**
   * Checks a payout account with the provider and records the verdict. With
   * no provider configured the account stays PENDING (no verdict is made up).
   * The first account that passes becomes where payouts go.
   */
  async checkPayoutAccount(account: PayoutAccount, accountNumber: string | null): Promise<PayoutAccount> {
    if (!this.provider) {
      return this.prisma.payoutAccount.update({
        where: { id: account.id },
        data: { verificationStatus: 'PENDING', verificationFailureReason: 'Bank checks are not switched on yet.' },
      });
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: account.userId }, select: { displayName: true } });
    // Who the account must belong to: the verified legal name; failing that
    // (identity verified by manual review), the holder name the worker typed;
    // failing that, their display name.
    const expectedName = (await this.legalName(account.userId)) ?? account.accountHolderName ?? user.displayName;

    let check: AccountCheck;
    if (account.type === 'BANK') {
      if (!accountNumber || !account.ifsc) throw new BusinessRuleError('Enter the account number again to check it.');
      check = await this.provider.checkBankAccount({
        verificationId: account.id,
        accountNumber,
        ifsc: account.ifsc,
        expectedName,
        holderName: account.accountHolderName,
      });
    } else {
      check = await this.provider.checkUpi({ verificationId: account.id, vpa: account.upiVpa ?? '', expectedName });
    }

    const decision = decideAccount(check, expectedName);
    const verified = decision.status === 'VERIFIED';
    const hasDefault =
      verified &&
      (await this.prisma.payoutAccount.count({
        where: { userId: account.userId, removedAt: null, isVerified: true, isDefault: true, id: { not: account.id } },
      })) > 0;

    const updated = await this.prisma.payoutAccount.update({
      where: { id: account.id },
      data: {
        verificationStatus: decision.status,
        verificationFailureReason: decision.reason,
        isVerified: verified,
        verifiedAt: verified ? new Date() : null,
        nameAtBank: check.nameAtBank,
        bankName: check.bankName,
        verificationReference: check.reference,
        ...(verified ? { isDefault: !hasDefault || account.isDefault } : { isDefault: false }),
      },
    });
    await this.audit.record({
      actorUserId: account.userId,
      action: 'PAYOUT_ACCOUNT_CHECKED',
      entityType: 'PayoutAccount',
      entityId: account.id,
      after: { status: decision.status, provider: this.provider.name, reference: check.reference },
    });
    return updated;
  }

  /** "Check again": re-runs the provider check with the stored (encrypted) account number. */
  async recheckPayoutAccount(userId: string, accountId: string): Promise<PayoutAccount> {
    const account = await this.prisma.payoutAccount.findFirst({ where: { id: accountId, userId, removedAt: null } });
    if (!account) throw new NotFoundError('Payout account not found.');
    if (account.verificationStatus === 'VERIFIED') return account;
    const number = account.accountNumberEncrypted ? this.encryption.decrypt(account.accountNumberEncrypted) : null;
    return this.checkPayoutAccount(account, number);
  }
}
