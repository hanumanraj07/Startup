import type { AccountCheck, IdentityResult, IdentitySession, VerificationProvider } from './verification.provider';

/**
 * A stand-in for the verification provider, outside production only.
 *
 * Identity: the "hosted page" is the app's own clearly labelled test page,
 * /kyc/digilocker-test, which completes the session through the API's
 * test-consent route (refused unless this provider is active). Polling here
 * therefore always says PENDING.
 *
 * Accounts, deterministically, so every outcome can be exercised:
 *   - a bank account number ending 1111 does not exist
 *   - a UPI ID starting invalid@ or incorrect@ does not exist; expired@ is inactive
 *   - otherwise valid, and the bank's record of the holder is the name typed
 *     in the form (a UPI ID is in the expected name), so typing someone
 *     else's name shows the name-mismatch path.
 */
export class MockVerificationProvider implements VerificationProvider {
  readonly name = 'MOCK' as const;

  async startIdentity(params: { verificationId: string }): Promise<IdentitySession> {
    return {
      providerReference: `mock-${params.verificationId}`,
      url: `/kyc/digilocker-test?session=${encodeURIComponent(params.verificationId)}`,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    };
  }

  async identityResult(): Promise<IdentityResult> {
    return { status: 'PENDING' };
  }

  async checkBankAccount(params: {
    verificationId: string;
    accountNumber: string;
    expectedName: string;
    holderName: string | null;
  }): Promise<AccountCheck> {
    if (params.accountNumber.endsWith('1111')) {
      return failed('The bank says this account number does not exist.');
    }
    return valid((params.holderName ?? params.expectedName).toUpperCase(), 'TEST BANK', params.verificationId);
  }

  async checkUpi(params: { verificationId: string; vpa: string; expectedName: string }): Promise<AccountCheck> {
    const handle = params.vpa.toLowerCase();
    if (handle.startsWith('invalid@') || handle.startsWith('incorrect@')) {
      return failed('This UPI ID could not be found. Check it in your UPI app.');
    }
    if (handle.startsWith('expired@')) return failed('This UPI ID is no longer active.');
    return valid(params.expectedName.toUpperCase(), 'TEST BANK (UPI)', params.verificationId);
  }
}

function valid(nameAtBank: string, bankName: string, verificationId: string): AccountCheck {
  return {
    outcome: 'VALID',
    nameAtBank,
    bankName,
    providerNameMatch: null,
    reference: `MOCKCHK${verificationId.replace(/-/g, '').slice(-10).toUpperCase()}`,
    reason: null,
  };
}

function failed(reason: string): AccountCheck {
  return { outcome: 'INVALID', nameAtBank: null, bankName: null, providerNameMatch: null, reference: null, reason };
}
