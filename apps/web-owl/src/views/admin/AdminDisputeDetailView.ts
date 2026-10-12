import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { AdminPage } from '@/components/admin/AdminPage';
import { EvidenceCard, type AdminProof } from '@/components/admin/EvidenceCard';
import { PartyCard, type AdminParty } from '@/components/admin/PartyCard';
import { formatTime } from '@/lib/format';
import { navigate, routerState } from '@/router/router';
import { ApiError, api } from '@/services/api';
import { btn, card, input } from '@/ui/classes';

type Resolution = 'RELEASE_TO_WORKER' | 'REFUND_TO_REQUESTER' | 'SPLIT';

interface EvidenceBundle {
  dispute: { id: string; reason: string; description: string; status: string; createdAt: string };
  instructions: { title: string; description: string };
  chat: { senderId: string; body: string; redactionFlags: string[]; createdAt: string }[];
  proofs: AdminProof[];
  arrivalRecords: { distanceFromTaskMeters: number; isWithinGeofence: boolean; createdAt: string }[];
  statusHistory: { toStatus: string; actorRole: string; reason: string | null; createdAt: string }[];
  payment: { status: string; amountPaise: number } | null;
  parties: { requester: AdminParty; worker: AdminParty | null };
}

const RESOLUTIONS: { value: Resolution; label: string }[] = [
  { value: 'RELEASE_TO_WORKER', label: 'Release to worker' },
  { value: 'SPLIT', label: 'Split' },
  { value: 'REFUND_TO_REQUESTER', label: 'Refund requester' },
];
/** The reasoning becomes part of the audit record, so a one-word note is not enough. */
const MIN_NOTES = 20;
const BAR = 'skeleton rounded-md';

/**
 * Resolving a dispute: everything both sides produced, then one decision with
 * written reasoning. The server moves the money; this only asks. A calm
 * screen: evidence is shown as it is, flags unsoftened.
 */
export class AdminDisputeDetailView extends Component {
  static override template = xml`
    <AdminPage breadcrumbs="[{ label: 'Disputes', to: '/admin/disputes' }, { label: 'Dispute' }]">
      <p t-if="state.loadError" role="alert" class="text-sm text-dispute" t-out="state.loadError"/>
      <div t-elif="!state.bundle" t-att-class="cardClass + ' flex flex-col gap-2 p-4'" aria-hidden="true">
        <div class="h-5 w-1/2 ${BAR}"/><div class="h-3 w-1/3 ${BAR}"/><div class="h-4 w-full ${BAR}"/>
      </div>

      <div t-else="" class="flex flex-col gap-4">
        <section t-att-class="cardClass + ' flex flex-col gap-2 p-4'">
          <h2 class="text-lg font-medium text-ink-900" t-out="bundle.instructions.title"/>
          <p class="text-sm text-ink-500">Disputed: <t t-out="reason"/></p>
          <p class="text-sm text-ink-700" t-out="bundle.dispute.description"/>
        </section>

        <div class="grid gap-4 sm:grid-cols-2">
          <PartyCard label="'Requester'" party="bundle.parties.requester"/>
          <PartyCard t-if="bundle.parties.worker" label="'Worker'" party="bundle.parties.worker"/>
        </div>

        <div t-if="bundle.payment" t-att-class="cardClass + ' flex items-center justify-between p-4 text-sm'">
          <span class="text-ink-500">Held payment</span>
          <span class="tabular font-semibold text-ink-900" t-out="held"/>
        </div>

        <div t-if="bundle.proofs.length > 0">
          <h2 class="mb-3 text-[17px] font-medium text-ink-900">Evidence</h2>
          <div class="grid gap-3 sm:grid-cols-2">
            <EvidenceCard t-foreach="bundle.proofs" t-as="proof" t-key="proof_index" proof="proof"/>
          </div>
        </div>

        <div t-if="bundle.chat.length > 0">
          <h2 class="mb-3 text-[17px] font-medium text-ink-900">Chat</h2>
          <div t-att-class="cardClass + ' flex flex-col gap-2 p-4'">
            <p t-foreach="bundle.chat" t-as="m" t-key="m_index" class="text-sm">
              <span class="text-ink-400" t-out="time(m)"/>
              <span class="ml-1 text-ink-700" t-out="m.body"/>
            </p>
          </div>
        </div>

        <section t-att-class="cardClass + ' flex flex-col gap-4 p-4'">
          <h2 class="text-lg font-medium text-ink-900">Resolve</h2>
          <div class="flex flex-wrap gap-2">
            <button t-foreach="resolutions" t-as="r" t-key="r.value" type="button"
              t-att-class="resolutionClass(r.value)" t-att-aria-pressed="state.resolution === r.value ? 'true' : 'false'"
              t-on-click="() => setResolution(r.value)" t-out="r.label"/>
          </div>
          <label t-if="state.resolution === 'SPLIT'" class="flex items-center gap-2 text-sm text-ink-700">
            Worker’s share
            <input type="number" min="0" max="100" t-att-class="shareClass" aria-label="Worker's share percent"
              t-att-value="state.workerSharePercent" t-on-input="onShare"/>
            %
          </label>
          <textarea t-att-class="notesClass" rows="3" placeholder="Reasoning (required — becomes part of the audit record)"
            aria-label="Reasoning" t-att-value="state.notes" t-on-input="onNotes"/>
          <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
          <button type="button" t-att-class="resolveClass" t-att-disabled="!canResolve or state.submitting"
            t-att-aria-busy="state.submitting ? 'true' : null" t-on-click="resolve">
            <span t-if="state.submitting" class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" aria-hidden="true"/>
            Resolve dispute
          </button>
        </section>
      </div>
    </AdminPage>`;
  static components = { AdminPage, EvidenceCard, PartyCard };
  static override props = {};

  router = useState(routerState);
  state = useState<{
    bundle: EvidenceBundle | null;
    loadError: string | null;
    resolution: Resolution;
    workerSharePercent: string;
    notes: string;
    submitting: boolean;
    error: string | null;
  }>({
    bundle: null,
    loadError: null,
    resolution: 'RELEASE_TO_WORKER',
    workerSharePercent: '50',
    notes: '',
    submitting: false,
    error: null,
  });

  resolutions = RESOLUTIONS;
  cardClass = card();
  shareClass = input(false, 'w-20');
  notesClass = input(false, 'min-h-[80px] py-2');
  resolveClass = btn('primary', 'default', 'w-full');

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  /** Only read once loaded; the template guards on state.bundle. */
  get bundle(): EvidenceBundle {
    return this.state.bundle as EvidenceBundle;
  }

  get reason(): string {
    return this.bundle.dispute.reason.replace(/_/g, ' ').toLowerCase();
  }

  get held(): string {
    const payment = this.bundle.payment;
    return payment ? `${formatPaise(payment.amountPaise)} (${payment.status.toLowerCase()})` : '';
  }

  get canResolve(): boolean {
    return this.state.notes.trim().length >= MIN_NOTES;
  }

  time(m: { createdAt: string }): string {
    return formatTime(m.createdAt);
  }

  resolutionClass(value: Resolution): string {
    return btn(this.state.resolution === value ? 'primary' : 'secondary', 'sm');
  }

  setResolution = (value: Resolution) => {
    this.state.resolution = value;
  };

  onShare = (ev: Event) => {
    this.state.workerSharePercent = (ev.target as HTMLInputElement).value;
  };

  onNotes = (ev: Event) => {
    this.state.notes = (ev.target as HTMLTextAreaElement).value;
  };

  private async load() {
    const id = this.router.params['id'];
    try {
      const bundle = await api.get<EvidenceBundle>(`/admin/disputes/${id}/evidence`);
      if (!this.disposed) this.state.bundle = bundle;
    } catch (error) {
      if (!this.disposed) this.state.loadError = error instanceof ApiError ? error.message : 'Could not load this dispute.';
    }
  }

  resolve = async () => {
    const { state } = this;
    state.submitting = true;
    state.error = null;
    try {
      await api.post(`/admin/disputes/${this.router.params['id']}/resolve`, {
        resolution: state.resolution,
        notes: state.notes.trim(),
        ...(state.resolution === 'SPLIT' ? { workerSharePercent: Number(state.workerSharePercent) } : {}),
      });
      navigate('/admin/disputes');
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : 'Could not resolve this dispute.';
    } finally {
      state.submitting = false;
    }
  };
}
