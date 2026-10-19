import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../../config/env';
import { CashfreeVerificationProvider } from './cashfree.provider';

/**
 * The Cashfree driver against a stubbed fetch: the request it builds (path,
 * headers, body fields as documented) and how it reads the answers. No
 * network, no credentials.
 */

beforeEach(() => {
  resetEnvCache();
  process.env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://onsite:onsite@localhost:5432/onsite_app',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    STORAGE_ENDPOINT: 'http://localhost:9000',
    STORAGE_BUCKET: 'onsite-media',
    STORAGE_ACCESS_KEY: 'x',
    STORAGE_SECRET_KEY: 'y',
    VERIFICATION_PROVIDER: 'cashfree',
    CASHFREE_VERIFICATION_CLIENT_ID: 'test-client',
    CASHFREE_VERIFICATION_CLIENT_SECRET: 'test-secret',
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(...responses: { status?: number; body: unknown }[]) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(r.body), { status: r.status ?? 200 }));
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> };
}

describe('CashfreeVerificationProvider', () => {
  it('creates a DigiLocker link for Aadhaar with our verification id and return URL', async () => {
    const fetchMock = stubFetch({ body: { reference_id: 12345, url: 'https://verification-test.cashfree.com/dgl/x', status: 'PENDING' } });
    const session = await new CashfreeVerificationProvider().startIdentity({
      verificationId: 'v-1',
      redirectUrl: 'https://onsite.example/kyc?session=v-1',
    });
    const { url, body, headers } = requestOf(fetchMock);
    expect(url).toBe('https://sandbox.cashfree.com/verification/digilocker');
    expect(body).toEqual({
      verification_id: 'v-1',
      document_requested: ['AADHAAR'],
      redirect_url: 'https://onsite.example/kyc?session=v-1',
      user_flow: 'signup',
    });
    expect(headers['x-client-id']).toBe('test-client');
    expect(headers['x-client-secret']).toBe('test-secret');
    expect(session).toEqual(expect.objectContaining({ providerReference: '12345', url: 'https://verification-test.cashfree.com/dgl/x' }));
  });

  it('reads an authenticated session and keeps only the name and the last four digits', async () => {
    stubFetch(
      { body: { status: 'AUTHENTICATED', document_consent: ['AADHAAR'], user_details: { name: 'John Doe' } } },
      { body: { status: 'SUCCESS', name: 'Mallesh Fakkirappa Dollin', uid: 'xxxxxxxx5647', dob: '02-02-1995', split_address: {} } },
    );
    const result = await new CashfreeVerificationProvider().identityResult({ verificationId: 'v-1' });
    expect(result).toEqual({ status: 'VERIFIED', name: 'Mallesh Fakkirappa Dollin', documentLast4: '5647' });
  });

  it('maps pending, expired and denied sessions', async () => {
    for (const status of ['PENDING', 'EXPIRED', 'CONSENT_DENIED'] as const) {
      stubFetch({ body: { status, user_details: {}, document_consent: null } });
      expect(await new CashfreeVerificationProvider().identityResult({ verificationId: 'v-1' })).toEqual({ status });
    }
  });

  it('checks a bank account with the expected name and reads the verdict', async () => {
    const fetchMock = stubFetch({
      body: {
        reference_id: 34,
        name_at_bank: 'BHARATHTEST GKUMARUT',
        bank_name: 'YES BANK',
        name_match_result: 'GOOD_PARTIAL_MATCH',
        account_status: 'VALID',
        account_status_code: 'ACCOUNT_IS_VALID',
      },
    });
    const check = await new CashfreeVerificationProvider().checkBankAccount({
      verificationId: 'acc-1',
      accountNumber: '026291800001191',
      ifsc: 'YESB0000262',
      expectedName: 'John Doe',
    });
    const { url, body } = requestOf(fetchMock);
    expect(url).toBe('https://sandbox.cashfree.com/verification/bank-account/sync');
    expect(body).toEqual({ bank_account: '026291800001191', ifsc: 'YESB0000262', name: 'John Doe' });
    expect(check).toEqual(
      expect.objectContaining({ outcome: 'VALID', nameAtBank: 'BHARATHTEST GKUMARUT', providerNameMatch: 'PARTIAL', reference: '34' }),
    );
  });

  it('turns an invalid account code into plain words', async () => {
    stubFetch({ body: { account_status: 'INVALID', account_status_code: 'INVALID_IFSC_FAIL' } });
    const check = await new CashfreeVerificationProvider().checkBankAccount({
      verificationId: 'acc-1',
      accountNumber: '2640101002729',
      ifsc: 'CNRR0002640',
      expectedName: 'John Doe',
    });
    expect(check).toEqual(expect.objectContaining({ outcome: 'INVALID', reason: 'The IFSC code is not valid.' }));
  });

  it('sends UPI checks with recorded consent', async () => {
    const fetchMock = stubFetch({ body: { status: 'VALID', name_at_bank: 'JOHN DOE', name_match_result: 'MATCH', reference_id: 9 } });
    const check = await new CashfreeVerificationProvider().checkUpi({ verificationId: 'acc-2', vpa: 'success@upi', expectedName: 'John Doe' });
    const { url, body } = requestOf(fetchMock);
    expect(url).toBe('https://sandbox.cashfree.com/verification/upi/penny-drop');
    expect(body.user_consent).toEqual(expect.objectContaining({ obtained: true, type: 'EXPLICIT' }));
    expect(body.user_consent.purpose.length).toBeGreaterThanOrEqual(20);
    expect(check).toEqual(expect.objectContaining({ outcome: 'VALID', providerNameMatch: 'MATCH' }));
  });

  it('reports an unreachable provider as unavailable, never as a failed account', async () => {
    stubFetch({ status: 503, body: { message: 'down' } });
    const check = await new CashfreeVerificationProvider().checkBankAccount({
      verificationId: 'acc-1',
      accountNumber: '026291800001191',
      ifsc: 'YESB0000262',
      expectedName: 'John Doe',
    });
    expect(check.outcome).toBe('UNAVAILABLE');
  });
});
