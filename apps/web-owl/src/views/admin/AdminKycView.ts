import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { AdminPage } from '@/components/admin/AdminPage';
import { EmptyState } from '@/components/EmptyState';
import { formatDateTime } from '@/lib/format';
import { ApiError, api } from '@/services/api';
import { btn, card, input } from '@/ui/classes';

type Decision = 'APPROVE' | 'REJECT' | 'RESUBMIT';

interface KycQueueItem {
  id: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  documentType: string;
  documentFrontUrl: string;
  documentBackUrl: string | null;
  selfieUrl: string;
  documentNumber: string;
  createdAt: string;
}

interface Photo {
  label: string;
  url: string;
}

const BAR = 'animate-pulse rounded bg-paper-100';

/**
 * The KYC review queue. Approving needs no reason; rejecting or asking for a
 * resubmission does, and the buttons stay disabled until there is one. A calm
 * screen: identity documents are shown as they are.
 */
export class AdminKycView extends Component {
  static override template = xml`
    <AdminPage breadcrumbs="[{ label: 'KYC queue' }]">
      <p t-if="state.error" role="alert" class="mb-3 text-sm text-dispute" t-out="state.error"/>

      <div t-if="!state.queue and !state.loadFailed" class="flex flex-col gap-4" aria-hidden="true">
        <div t-foreach="[0, 1]" t-as="i" t-key="i" t-att-class="itemClass">
          <div class="flex items-center justify-between">
            <div class="flex flex-col gap-2"><div class="h-4 w-32 ${BAR}"/><div class="h-3 w-40 ${BAR}"/></div>
            <div class="h-3 w-24 ${BAR}"/>
          </div>
          <div class="grid grid-cols-3 gap-2"><div class="aspect-[4/3] ${BAR}"/><div class="aspect-[4/3] ${BAR}"/><div class="aspect-[4/3] ${BAR}"/></div>
        </div>
      </div>
      <EmptyState t-elif="state.queue and state.queue.length === 0" title="'Queue is empty'" description="'No KYC submissions are waiting for review.'"/>
      <div t-elif="state.queue" class="flex flex-col gap-4">
        <div t-foreach="state.queue" t-as="item" t-key="item.id" t-att-class="itemClass">
          <div class="flex items-center justify-between">
            <div>
              <p class="font-medium text-ink-900" t-out="item.userDisplayName"/>
              <p class="text-sm text-ink-500" t-out="item.userEmail"/>
            </div>
            <span class="text-xs text-ink-400" t-out="submitted(item)"/>
          </div>

          <p class="text-sm">
            <span class="text-ink-500"><t t-out="docType(item)"/>:</span>
            <span class="tabular ml-1 font-medium text-ink-900" t-out="item.documentNumber"/>
          </p>

          <div class="grid grid-cols-3 gap-2">
            <a t-foreach="photos(item)" t-as="photo" t-key="photo.label" t-att-href="photo.url" target="_blank" rel="noreferrer" class="block">
              <img t-att-src="photo.url" t-att-alt="photo.label" class="aspect-[4/3] w-full rounded-input border border-line object-cover"/>
              <span class="mt-1 block text-center text-xs text-ink-400" t-out="photo.label"/>
            </a>
          </div>

          <textarea t-att-class="areaClass" rows="2" placeholder="Reason (required to reject or ask for resubmission)"
            aria-label="Reason" t-att-value="reasonFor(item)" t-on-input="(ev) => setReason(item.id, ev)"/>

          <div class="flex flex-wrap gap-2">
            <button type="button" t-att-class="approveClass" t-att-disabled="isBusy(item)" t-on-click="() => decide(item.id, 'APPROVE')">Approve</button>
            <button type="button" t-att-class="resubmitClass" t-att-disabled="isBusy(item) or !hasReason(item)" t-on-click="() => decide(item.id, 'RESUBMIT')">Ask to resubmit</button>
            <button type="button" t-att-class="rejectClass" t-att-disabled="isBusy(item) or !hasReason(item)" t-on-click="() => decide(item.id, 'REJECT')">Reject</button>
          </div>
        </div>
      </div>
    </AdminPage>`;
  static components = { AdminPage, EmptyState };
  static override props = {};

  state = useState<{
    queue: KycQueueItem[] | null;
    loadFailed: boolean;
    error: string | null;
    busyId: string | null;
    reasons: Record<string, string>;
  }>({ queue: null, loadFailed: false, error: null, busyId: null, reasons: {} });

  itemClass = card('flex flex-col gap-4 p-4');
  areaClass = input(false, 'min-h-[56px] py-2');
  approveClass = btn('primary');
  resubmitClass = btn('secondary');
  rejectClass = btn('destructive');

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  submitted(item: KycQueueItem): string {
    return formatDateTime(item.createdAt);
  }

  docType(item: KycQueueItem): string {
    return item.documentType.replace(/_/g, ' ').toLowerCase();
  }

  photos(item: KycQueueItem): Photo[] {
    const photos: Photo[] = [{ label: 'Front', url: item.documentFrontUrl }];
    if (item.documentBackUrl) photos.push({ label: 'Back', url: item.documentBackUrl });
    photos.push({ label: 'Selfie', url: item.selfieUrl });
    return photos;
  }

  reasonFor(item: KycQueueItem): string {
    return this.state.reasons[item.id] ?? '';
  }

  hasReason(item: KycQueueItem): boolean {
    return this.reasonFor(item).trim().length > 0;
  }

  isBusy(item: KycQueueItem): boolean {
    return this.state.busyId === item.id;
  }

  setReason = (id: string, ev: Event) => {
    this.state.reasons[id] = (ev.target as HTMLTextAreaElement).value;
  };

  private async load() {
    try {
      const res = await api.get<{ data: KycQueueItem[] }>('/admin/kyc?limit=20');
      if (!this.disposed) this.state.queue = res.data;
    } catch (error) {
      if (!this.disposed) {
        this.state.loadFailed = true;
        this.state.error = error instanceof ApiError ? error.message : 'Could not load the KYC queue.';
      }
    }
  }

  decide = async (id: string, decision: Decision) => {
    const { state } = this;
    state.busyId = id;
    state.error = null;
    try {
      await api.post(`/admin/kyc/${id}/decision`, { decision, reason: state.reasons[id] });
      state.queue = state.queue?.filter((item) => item.id !== id) ?? null;
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : 'Could not record that decision.';
    } finally {
      state.busyId = null;
    }
  };
}
