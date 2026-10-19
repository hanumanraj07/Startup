import { Logger } from '@nestjs/common';
import { loadEnv } from '../../config/env';
import type { NameMatch } from './name-match';
import {
  ProviderUnavailableError,
  type AccountCheck,
  type IdentityResult,
  type IdentitySession,
  type VerificationProvider,
} from './verification.provider';

/** DigiLocker consent links expire ten minutes after they are created (Cashfree's documented limit). */
const LINK_TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 15_000;

/**
 * Cashfree Secure ID (Verification API): DigiLocker for identity, bank
 * account verification (BAV v2, synchronous) and UPI penny drop for payout
 * accounts. Chosen over the payment gateway because Razorpay offers no public
 * end-user PAN or Aadhaar verification, and its fund-account validation needs
 * RazorpayX and has no test mode (ai/memory.md, P4). Works alongside Razorpay;
 * nothing here moves money except the provider's own ₹1 checks.
 *
 * Endpoints and fields follow Cashfree's documentation as read on 2026-10-19:
 *   POST /digilocker, GET /digilocker, GET /digilocker/document/AADHAAR,
 *   POST /bank-account/sync, POST /upi/penny-drop.
 * Base URL: https://sandbox.cashfree.com/verification (sandbox) or
 * https://api.cashfree.com/verification (production), set by
 * CASHFREE_VERIFICATION_BASE_URL. Never logs a secret, an account number or
 * a document number.
 */
export class CashfreeVerificationProvider implements VerificationProvider {
  readonly name = 'CASHFREE' as const;
  private readonly logger = new Logger(CashfreeVerificationProvider.name);

  async startIdentity(params: { verificationId: string; redirectUrl: string }): Promise<IdentitySession> {
    const body = await this.call<{ reference_id: number; url: string }>('POST', '/digilocker', {
      verification_id: params.verificationId,
      document_requested: ['AADHAAR'],
      redirect_url: params.redirectUrl,
      user_flow: 'signup',
    });
    return { providerReference: String(body.reference_id), url: body.url, expiresAt: new Date(Date.now() + LINK_TTL_MS) };
  }

  async identityResult(params: { verificationId: string }): Promise<IdentityResult> {
    const query = `verification_id=${encodeURIComponent(params.verificationId)}`;
    const status = await this.call<{
      status: 'PENDING' | 'AUTHENTICATED' | 'EXPIRED' | 'CONSENT_DENIED';
      user_details?: { name?: string };
      document_consent?: string[] | null;
    }>('GET', `/digilocker?${query}`);

    if (status.status === 'PENDING') return { status: 'PENDING' };
    if (status.status === 'EXPIRED') return { status: 'EXPIRED' };
    if (status.status === 'CONSENT_DENIED') return { status: 'CONSENT_DENIED' };

    if (!status.document_consent?.includes('AADHAAR')) {
      return { status: 'FAILED', reason: 'Aadhaar was not shared from DigiLocker, so your identity could not be confirmed.' };
    }
    const aadhaar = await this.call<{ status: string; name?: string; uid?: string }>(
      'GET',
      `/digilocker/document/AADHAAR?${query}`,
    );
    const name = aadhaar.name?.trim() || status.user_details?.name?.trim();
    if (aadhaar.status !== 'SUCCESS' || !name) {
      return { status: 'FAILED', reason: 'DigiLocker did not return your Aadhaar details. Try again, or upload your documents instead.' };
    }
    // The uid comes masked ("xxxxxxxx5647"); only its last four digits are kept.
    const last4 = aadhaar.uid?.replace(/\D/g, '').slice(-4) || null;
    return { status: 'VERIFIED', name, documentLast4: last4 };
  }

  async checkBankAccount(params: {
    verificationId: string;
    accountNumber: string;
    ifsc: string;
    expectedName: string;
  }): Promise<AccountCheck> {
    try {
      const body = await this.call<{
        reference_id?: number;
        account_status?: 'VALID' | 'INVALID';
        account_status_code?: string;
        name_at_bank?: string | null;
        bank_name?: string | null;
        name_match_result?: string | null;
        utr?: string | null;
      }>('POST', '/bank-account/sync', {
        bank_account: params.accountNumber,
        ifsc: params.ifsc,
        name: sanitiseName(params.expectedName),
      });
      if (body.account_status !== 'VALID') {
        return invalid(BANK_FAILURE[body.account_status_code ?? ''] ?? 'The bank could not confirm this account.');
      }
      return {
        outcome: 'VALID',
        nameAtBank: body.name_at_bank ?? null,
        bankName: body.bank_name ?? null,
        providerNameMatch: mapNameMatch(body.name_match_result),
        reference: body.reference_id !== undefined ? String(body.reference_id) : (body.utr ?? null),
        reason: null,
      };
    } catch (error) {
      return unavailable(error);
    }
  }

  async checkUpi(params: { verificationId: string; vpa: string; expectedName: string }): Promise<AccountCheck> {
    try {
      const body = await this.call<{
        reference_id?: number;
        status?: string;
        name_at_bank?: string | null;
        name_match_result?: string | null;
        ifsc_details?: { bank?: string };
      }>('POST', '/upi/penny-drop', {
        verification_id: params.verificationId,
        vpa: params.vpa,
        name: sanitiseName(params.expectedName),
        user_consent: {
          obtained: true,
          type: 'EXPLICIT',
          timestamp: new Date().toISOString(),
          purpose: 'Verify the UPI ID so task earnings are paid to its owner',
        },
      });
      if (body.status !== 'VALID' && body.status !== 'SUCCESS') {
        return invalid(
          body.status === 'EXPIRED' ? 'This UPI ID is no longer active.' : 'This UPI ID could not be found. Check it in your UPI app.',
        );
      }
      return {
        outcome: 'VALID',
        nameAtBank: body.name_at_bank ?? null,
        bankName: body.ifsc_details?.bank ?? null,
        providerNameMatch: mapNameMatch(body.name_match_result),
        reference: body.reference_id !== undefined ? String(body.reference_id) : null,
        reason: null,
      };
    } catch (error) {
      return unavailable(error);
    }
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const env = loadEnv();
    let res: Response;
    try {
      res = await fetch(`${env.CASHFREE_VERIFICATION_BASE_URL}${path}`, {
        method,
        headers: {
          'x-client-id': env.CASHFREE_VERIFICATION_CLIENT_ID ?? '',
          'x-client-secret': env.CASHFREE_VERIFICATION_CLIENT_SECRET ?? '',
          'x-api-version': env.CASHFREE_VERIFICATION_API_VERSION,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ProviderUnavailableError(`Verification provider unreachable: ${String(error)}`);
    }
    const text = await res.text();
    if (!res.ok) {
      // The path is logged, never the body: it can carry account numbers.
      this.logger.warn(`Cashfree ${method} ${path.split('?')[0]} → ${res.status}: ${text.slice(0, 200)}`);
      throw new ProviderUnavailableError(`Verification provider returned ${res.status}`);
    }
    return JSON.parse(text) as T;
  }
}

const BANK_FAILURE: Record<string, string> = {
  INVALID_ACCOUNT_FAIL: 'The bank says this account number does not exist.',
  ACCOUNT_BLOCKED: 'This account is blocked or closed.',
  INVALID_IFSC_FAIL: 'The IFSC code is not valid.',
  NRE_ACCOUNT_FAIL: 'NRE accounts cannot receive payouts. Use a savings or current account in India.',
};

/** Cashfree's name field allows letters, digits, spaces and . - / & only. */
function sanitiseName(name: string): string {
  return name.replace(/[^A-Za-z0-9 .\-/&]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function mapNameMatch(result: string | null | undefined): NameMatch | null {
  if (!result) return null;
  if (result === 'DIRECT_MATCH' || result === 'MATCH') return 'MATCH';
  if (result === 'GOOD_PARTIAL_MATCH') return 'PARTIAL';
  // MODERATE_PARTIAL_MATCH, POOR_PARTIAL_MATCH, NO_MATCH, and anything new.
  return 'MISMATCH';
}

function invalid(reason: string): AccountCheck {
  return { outcome: 'INVALID', nameAtBank: null, bankName: null, providerNameMatch: null, reference: null, reason };
}

function unavailable(error: unknown): AccountCheck {
  if (!(error instanceof ProviderUnavailableError)) throw error;
  return {
    outcome: 'UNAVAILABLE',
    nameAtBank: null,
    bankName: null,
    providerNameMatch: null,
    reference: null,
    reason: 'We could not reach the bank check just now. Try again in a few minutes.',
  };
}
