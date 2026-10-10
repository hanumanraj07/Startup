import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import type { KycStatus } from '@onsite/types';
import { Icon } from '@/components/Icon';
import { Page } from '@/components/Page';
import { TextField } from '@/components/TextField';
import { ApiError, api } from '@/services/api';
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

const BAR = 'animate-pulse rounded bg-paper-100';

/**
 * Identity verification: a government ID and a selfie, reviewed by an admin.
 * A calm screen (identity documents carry the same trust weight as proof).
 * The document number is encrypted server-side and never read back.
 */
export class KycView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Identity verification' }]">
      <div class="mx-auto flex max-w-xl flex-col gap-4">
        <p class="text-sm text-ink-500">
          Government ID and a selfie, admin approved — required to accept tasks above ₹1,000 (verification level 2).
        </p>

        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>

        <div t-elif="!state.status" t-att-class="cardClass" aria-hidden="true">
          <div class="${CARD_CONTENT} flex items-start gap-3">
            <div class="h-5 w-5 rounded-full ${BAR}"/>
            <div class="flex flex-col gap-2"><div class="h-4 w-32 ${BAR}"/><div class="h-3 w-48 ${BAR}"/></div>
          </div>
        </div>

        <t t-else="">
          <div t-if="status === 'PENDING'" t-att-class="cardClass">
            <div class="${CARD_CONTENT} flex items-start gap-3">
              <Icon name="'clock'" size="20" class="'mt-0.5 shrink-0 text-progress'"/>
              <div>
                <p class="font-medium text-ink-900">Under review</p>
                <p class="mt-1 text-sm text-ink-500">We’ll notify you once it’s been checked. This usually takes under a day.</p>
              </div>
            </div>
          </div>

          <div t-elif="status === 'APPROVED'" t-att-class="cardClass">
            <div class="${CARD_CONTENT} flex items-start gap-3">
              <Icon name="'circle-check'" size="20" class="'mt-0.5 shrink-0 text-verified'"/>
              <div>
                <p class="font-medium text-ink-900">Verified</p>
                <p class="mt-1 text-sm text-ink-500">You can accept tasks up to ₹5,000.</p>
              </div>
            </div>
          </div>

          <t t-else="">
            <div t-if="status === 'REJECTED'" t-att-class="cardClass">
              <div class="${CARD_CONTENT} flex items-start gap-3">
                <Icon name="'circle-x'" size="20" class="'mt-0.5 shrink-0 text-dispute'"/>
                <div>
                  <p class="font-medium text-ink-900">Submission rejected</p>
                  <p class="mt-1 text-sm text-ink-500" t-out="rejectionReason"/>
                </div>
              </div>
            </div>

            <section t-att-class="cardClass">
              <div class="${CARD_HEADER}">
                <h2 class="${CARD_TITLE}">Submit your documents</h2>
                <p class="${CARD_DESCRIPTION}">Accepted: Aadhaar, PAN, driving licence, voter ID, passport.</p>
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
      </div>
    </Page>`;
  static components = { DocumentUpload, Icon, Page, TextField };
  static override props = {};

  state = useState<{ status: KycStatusResponse | null; error: string | null }>({ status: null, error: null });
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

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  get status(): KycStatusResponse['status'] | undefined {
    return this.state.status?.status;
  }

  get rejectionReason(): string {
    return this.state.status?.rejectionReason ?? 'Please resubmit with clearer documents.';
  }

  get canSubmit(): boolean {
    const f = this.form;
    return f.documentNumber.trim().length >= 4 && f.frontKey !== null && f.selfieKey !== null;
  }

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

  private async load() {
    try {
      const status = await api.get<KycStatusResponse>('/users/me/kyc');
      if (!this.disposed) this.state.status = status;
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
