import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import type { KycStatus } from '@onsite/types';
import { Icon } from '@/components/Icon';
import { Page } from '@/components/Page';
import { TextField } from '@/components/TextField';
import type { VerificationStatus } from '@/lib/api-types';
import { navigate, routerState } from '@/router/router';
import { ApiError, api } from '@/services/api';
import { toast } from '@/store/store';
import { btn, card, CARD_CONTENT, CARD_DESCRIPTION, CARD_HEADER, CARD_TITLE, input, LABEL } from '@/ui/classes';
import { DocumentUpload } from './kyc/DocumentUpload';

interface KycStatusResponse {
  status: KycStatus | 'NONE';
  rejectionReason?: string | null;
  submittedAt?: string;
}

const DOCUMENT_TYPES = [
  { value: 'AADHAAR', label: 'Aadhaar' },
  { value: 'PAN', label: 'PAN card' },
  { value: 'DRIVING_LICENCE', label: 'Driving licence' },
  { value: 'VOTER_ID', label: 'Voter ID' },
  { value: 'PASSPORT', label: 'Passport' },
] as const;

const OUTCOME_TEXT: Record<string, string> = {
  CONSENT_DENIED: 'You chose not to share your details in DigiLocker. Nothing was verified.',
  EXPIRED: 'The DigiLocker link expired before it was completed. Links last 10 minutes.',
};

const BAR = 'skeleton rounded-md';
/** How long to keep asking after the user returns from DigiLocker, before saying it is still processing. */
const POLL_ATTEMPTS = 10;
const POLL_MS = 2000;

/**
 * Identity verification. The quick way: share Aadhaar from DigiLocker through
 * the verification provider (consent-based; we keep only the name and the
 * last four digits), which verifies straight away. The fallback: upload a
 * government ID and a selfie for an admin to review. Either reaches level 2.
 * A calm screen: identity carries the same trust weight as proof.
 */
export class KycView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Identity verification' }]">
      <div class="mx-auto flex max-w-xl flex-col gap-4">
        <p class="text-sm text-ink-500">
          Needed to receive payouts and to accept tasks above ₹1,000 (verification level 2).
        </p>

        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>

        <div t-elif="!state.status or !state.verification" t-att-class="cardClass" aria-hidden="true">
          <div class="${CARD_CONTENT} flex items-start gap-3">
            <div class="h-5 w-5 rounded-full ${BAR}"/>
            <div class="flex flex-col gap-2"><div class="h-4 w-32 ${BAR}"/><div class="h-3 w-48 ${BAR}"/></div>
          </div>
        </div>

        <t t-else="">
          <div t-if="verified" t-att-class="cardClass">
            <div class="${CARD_CONTENT} flex items-start gap-3">
              <Icon name="'badge-check'" size="22" class="'mt-0.5 shrink-0 text-verified'"/>
              <div>
                <p class="font-medium text-ink-900">Identity verified</p>
                <p class="mt-1 text-sm text-ink-500" t-out="verifiedDetail"/>
              </div>
            </div>
          </div>

          <div t-elif="status === 'PENDING'" t-att-class="cardClass">
            <div class="${CARD_CONTENT} flex items-start gap-3">
              <Icon name="'clock'" size="20" class="'mt-0.5 shrink-0 text-progress'"/>
              <div>
                <p class="font-medium text-ink-900">Documents under review</p>
                <p class="mt-1 text-sm text-ink-500">We’ll notify you once they have been checked. This usually takes under a day.</p>
              </div>
            </div>
          </div>

          <t t-else="">
            <section t-if="automatic" t-att-class="cardClass" aria-labelledby="digilocker-title">
              <div class="${CARD_HEADER}">
                <h2 id="digilocker-title" class="${CARD_TITLE}">Verify with DigiLocker</h2>
                <p class="${CARD_DESCRIPTION}">About a minute. You sign in to DigiLocker and choose to share your Aadhaar.</p>
              </div>
              <div class="${CARD_CONTENT} flex flex-col gap-4">
                <ul class="flex flex-col gap-2 text-sm text-ink-700">
                  <li class="flex gap-2"><Icon name="'check'" size="16" class="'mt-0.5 shrink-0 text-verified'"/> Verified at once, no waiting for a review</li>
                  <li class="flex gap-2"><Icon name="'lock'" size="16" class="'mt-0.5 shrink-0 text-verified'"/> We keep only your name and the last 4 digits of your Aadhaar. Never the number, address or photo.</li>
                  <li class="flex gap-2"><Icon name="'shield-check'" size="16" class="'mt-0.5 shrink-0 text-verified'"/> Your bank account is then checked against this name, so payouts reach only you</li>
                </ul>

                <p t-if="state.polling" role="status" class="flex items-center gap-2 rounded-input bg-paper-100 px-3 py-2 text-sm text-ink-700">
                  <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-300 border-t-ink-900" aria-hidden="true"/>
                  Checking with DigiLocker…
                </p>
                <p t-elif="lastOutcome" role="alert" class="rounded-input bg-tint-orange px-3 py-2 text-sm text-[#7a3d00]" t-out="lastOutcome"/>

                <button type="button" t-att-class="startClass" t-att-disabled="state.starting or state.polling or attemptsLeft === 0"
                  t-att-aria-busy="state.starting ? 'true' : null" t-on-click="startDigilocker">
                  <span t-if="state.starting" class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" aria-hidden="true"/>
                  <t t-out="lastOutcome ? 'Try again with DigiLocker' : 'Continue to DigiLocker'"/>
                </button>
                <p class="text-xs text-ink-400">
                  <t t-if="attemptsLeft === 0">No attempts left today. Upload your documents below, or try again tomorrow.</t>
                  <t t-elif="state.verification.provider === 'mock'">Test mode: you will see a stand-in for DigiLocker, not the real service.</t>
                  <t t-else="">Through Cashfree Secure ID, our verification provider. You can stop at any point.</t>
                </p>
              </div>
            </section>

            <div t-if="automatic and !state.showManual" class="text-center">
              <button type="button" class="text-sm font-medium text-accent-600 hover:underline" t-on-click="showManual">
                No DigiLocker? Upload your documents instead
              </button>
            </div>

            <t t-if="!automatic or state.showManual">
              <div t-if="status === 'REJECTED' or status === 'RESUBMIT'" t-att-class="cardClass">
                <div class="${CARD_CONTENT} flex items-start gap-3">
                  <Icon name="'circle-x'" size="20" class="'mt-0.5 shrink-0 text-dispute'"/>
                  <div>
                    <p class="font-medium text-ink-900">Submission not accepted</p>
                    <p class="mt-1 text-sm text-ink-500" t-out="rejectionReason"/>
                  </div>
                </div>
              </div>

              <section t-att-class="cardClass">
                <div class="${CARD_HEADER}">
                  <h2 class="${CARD_TITLE}">Upload your documents</h2>
                  <p class="${CARD_DESCRIPTION}">Checked by our team, usually within a day. Accepted: Aadhaar, PAN, driving licence, voter ID, passport.</p>
                </div>
                <div class="${CARD_CONTENT} flex flex-col gap-4">
                  <div class="flex flex-col gap-1.5">
                    <label for="documentType" class="${LABEL}">Document type</label>
                    <select id="documentType" t-att-class="selectClass" t-on-change="onType">
                      <option t-foreach="documentTypes" t-as="d" t-key="d.value" t-att-value="d.value"
                        t-att-selected="d.value === form.documentType" t-out="d.label"/>
                    </select>
                  </div>

                  <TextField id="'documentNumber'" label="'Document number'" maxlength="40"
                    value="form.documentNumber" onInput="setNumber"/>

                  <div class="grid grid-cols-2 gap-3">
                    <DocumentUpload label="'Front'" kind="'front'" uploaded="form.frontKey !== null" onUploaded="setFront"/>
                    <DocumentUpload label="'Back (optional)'" kind="'back'" uploaded="form.backKey !== null" onUploaded="setBack"/>
                  </div>
                  <DocumentUpload label="'Selfie'" kind="'selfie'" uploaded="form.selfieKey !== null" onUploaded="setSelfie"/>

                  <p class="text-xs text-ink-400">
                    Your document number is encrypted before storage and is never returned by any endpoint, including this one.
                  </p>

                  <p t-if="form.error" role="alert" class="text-sm text-dispute" t-out="form.error"/>

                  <button type="button" t-att-class="submitClass" t-att-disabled="!canSubmit or form.submitting"
                    t-att-aria-busy="form.submitting ? 'true' : null" t-on-click="submit">
                    <span t-if="form.submitting" class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" aria-hidden="true"/>
                    Submit for review
                  </button>
                </div>
              </section>
            </t>
          </t>
        </t>
      </div>
    </Page>`;
  static components = { DocumentUpload, Icon, Page, TextField };
  static override props = {};

  state = useState<{
    status: KycStatusResponse | null;
    verification: VerificationStatus | null;
    error: string | null;
    starting: boolean;
    polling: boolean;
    showManual: boolean;
  }>({ status: null, verification: null, error: null, starting: false, polling: false, showManual: false });
  form = useState<{
    documentType: string;
    documentNumber: string;
    frontKey: string | null;
    backKey: string | null;
    selfieKey: string | null;
    submitting: boolean;
    error: string | null;
  }>({
    documentType: 'AADHAAR',
    documentNumber: '',
    frontKey: null,
    backKey: null,
    selfieKey: null,
    submitting: false,
    error: null,
  });

  documentTypes = DOCUMENT_TYPES;
  cardClass = card();
  selectClass = input();
  submitClass = btn('primary', 'default', 'w-full');
  startClass = btn('primary', 'lg', 'w-full');

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load().then(() => {
        // Back from the provider's page: ask where that session stands.
        const session = routerState.query.session;
        if (session) void this.pollSession(session);
      });
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  get status(): KycStatusResponse['status'] | undefined {
    return this.state.status?.status;
  }

  get verified(): boolean {
    return Boolean(this.state.verification?.identityVerified);
  }

  get automatic(): boolean {
    return this.state.verification?.provider !== 'none';
  }

  get attemptsLeft(): number {
    return this.state.verification?.attemptsLeftToday ?? 0;
  }

  get verifiedDetail(): string {
    const identity = this.state.verification?.identity;
    if (identity?.status === 'VERIFIED' && identity.verifiedName) {
      const last4 = identity.documentLast4 ? ` · Aadhaar ••${identity.documentLast4}` : '';
      return `Verified with DigiLocker as ${identity.verifiedName}${last4}. You can receive payouts and accept tasks up to ₹5,000.`;
    }
    return 'Verified by document review. You can receive payouts and accept tasks up to ₹5,000.';
  }

  /** Why the last automated attempt did not verify, if it did not. */
  get lastOutcome(): string | null {
    const identity = this.state.verification?.identity;
    if (!identity || identity.status === 'VERIFIED' || identity.status === 'PENDING') return null;
    return OUTCOME_TEXT[identity.status] ?? identity.failureReason ?? 'DigiLocker could not confirm your identity.';
  }

  get rejectionReason(): string {
    return this.state.status?.rejectionReason ?? 'Please resubmit with clearer documents.';
  }

  get canSubmit(): boolean {
    const f = this.form;
    return f.documentNumber.trim().length >= 4 && f.frontKey !== null && f.selfieKey !== null;
  }

  showManual = () => {
    this.state.showManual = true;
  };

  onType = (ev: Event) => {
    this.form.documentType = (ev.target as HTMLSelectElement).value;
  };

  setNumber = (v: string) => {
    this.form.documentNumber = v;
  };

  setFront = (key: string) => {
    this.form.frontKey = key;
  };

  setBack = (key: string) => {
    this.form.backKey = key;
  };

  setSelfie = (key: string) => {
    this.form.selfieKey = key;
  };

  startDigilocker = async () => {
    this.state.starting = true;
    try {
      const session = await api.post<{ sessionId: string; url: string }>('/users/me/verification/identity');
      // The provider's hosted page is another site; the mock's test page is in this app.
      if (/^https?:\/\//.test(session.url)) window.location.assign(session.url);
      else navigate(session.url);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not start the verification. Try again.', { variant: 'error' });
      await this.load();
    } finally {
      this.state.starting = false;
    }
  };

  private async pollSession(sessionId: string) {
    this.state.polling = true;
    try {
      for (let attempt = 0; attempt < POLL_ATTEMPTS && !this.disposed; attempt++) {
        const identity = await api.post<{ status: string }>(`/users/me/verification/identity/${sessionId}/refresh`);
        if (identity.status !== 'PENDING') break;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      await this.load();
      if (this.verified) toast('Identity verified', { description: 'You can now add a payout account.', variant: 'success' });
    } catch (error) {
      if (!this.disposed) toast(error instanceof ApiError ? error.message : 'Could not check the verification.', { variant: 'error' });
    } finally {
      if (!this.disposed) this.state.polling = false;
      // Drop ?session= so a reload does not poll an old session again.
      navigate('/kyc', { replace: true });
    }
  }

  private async load() {
    try {
      const [status, verification] = await Promise.all([
        api.get<KycStatusResponse>('/users/me/kyc'),
        api.get<VerificationStatus>('/users/me/verification'),
      ]);
      if (this.disposed) return;
      this.state.status = status;
      this.state.verification = verification;
    } catch (error) {
      if (!this.disposed) {
        this.state.error = error instanceof ApiError ? error.message : 'Could not load your verification status.';
      }
    }
  }

  submit = async () => {
    const { form } = this;
    form.submitting = true;
    form.error = null;
    try {
      await api.post('/users/me/kyc', {
        documentType: form.documentType,
        documentNumber: form.documentNumber.trim(),
        documentFrontKey: form.frontKey,
        ...(form.backKey ? { documentBackKey: form.backKey } : {}),
        selfieKey: form.selfieKey,
      });
      this.state.status = { status: 'PENDING' };
    } catch (error) {
      form.error = error instanceof ApiError ? error.message : 'Could not submit. Try again.';
    } finally {
      form.submitting = false;
    }
  };
}
