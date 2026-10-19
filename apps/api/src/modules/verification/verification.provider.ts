import type { NameMatch } from './name-match';

/**
 * A third-party identity and bank verification service. Two implementations:
 * Cashfree Secure ID (cashfree.provider.ts) and a mock for development and
 * tests (mock.provider.ts). Nothing outside this module talks to either.
 */
export interface VerificationProvider {
  readonly name: 'MOCK' | 'CASHFREE';

  /** Starts a consent-based identity check (DigiLocker) and returns where to send the user. */
  startIdentity(params: { verificationId: string; redirectUrl: string }): Promise<IdentitySession>;

  /** Where an identity check stands now. */
  identityResult(params: { verificationId: string }): Promise<IdentityResult>;

  checkBankAccount(params: {
    verificationId: string;
    accountNumber: string;
    ifsc: string;
    /** The name the account should be in: the verified legal name, when there is one. */
    expectedName: string;
    /** What the worker typed as the holder. The mock treats it as the bank's record. */
    holderName: string | null;
  }): Promise<AccountCheck>;

  checkUpi(params: { verificationId: string; vpa: string; expectedName: string }): Promise<AccountCheck>;
}

export const VERIFICATION_PROVIDER = Symbol('VERIFICATION_PROVIDER');

export interface IdentitySession {
  providerReference: string;
  /** Absolute (the provider's hosted page) or app-relative (the mock's test page). */
  url: string;
  expiresAt: Date;
}

export type IdentityResult =
  | { status: 'PENDING' }
  | { status: 'VERIFIED'; name: string; documentLast4: string | null }
  | { status: 'CONSENT_DENIED' }
  | { status: 'EXPIRED' }
  | { status: 'FAILED'; reason: string };

export interface AccountCheck {
  /** UNAVAILABLE: the check itself could not run (network, provider error). Never a verdict on the account. */
  outcome: 'VALID' | 'INVALID' | 'UNAVAILABLE';
  nameAtBank: string | null;
  bankName: string | null;
  /** The provider's own name-match verdict, when it ran one; otherwise ours is used. */
  providerNameMatch: NameMatch | null;
  reference: string | null;
  /** Plain words for INVALID and UNAVAILABLE. */
  reason: string | null;
}

/** Thrown for a provider call that failed in a way the user should simply retry. */
export class ProviderUnavailableError extends Error {}
