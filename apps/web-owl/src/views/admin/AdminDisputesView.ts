import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { AdminPage } from '@/components/admin/AdminPage';
import { EmptyState } from '@/components/EmptyState';
import { Link } from '@/components/Link';
import { ApiError, api } from '@/services/api';
import { card } from '@/ui/classes';

interface DisputeQueueItem {
  id: string;
  taskId: string;
  taskTitle: string;
  reason: string;
  status: string;
  createdAt: string;
  ageHours: number;
}

const BAR = 'animate-pulse rounded bg-paper-100';

/** Open disputes, oldest pressure first. Anything past 48 hours is shown in the dispute colour. */
export class AdminDisputesView extends Component {
  static override template = xml`
    <AdminPage breadcrumbs="[{ label: 'Disputes' }]">
      <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
      <div t-elif="!state.disputes" t-att-class="cardClass" aria-hidden="true">
        <div t-foreach="[0, 1, 2]" t-as="i" t-key="i" class="flex items-center justify-between gap-4 border-b border-line px-4 py-4 last:border-b-0">
          <div class="flex flex-col gap-2"><div class="h-4 w-40 ${BAR}"/><div class="h-3 w-28 ${BAR}"/></div>
          <div class="h-3 w-14 ${BAR}"/>
        </div>
      </div>
      <EmptyState t-elif="state.disputes.length === 0" title="'Queue is empty'" description="'No disputes are open right now.'"/>
      <div t-else="" t-att-class="cardClass">
        <Link t-foreach="state.disputes" t-as="d" t-key="d.id" to="'/admin/disputes/' + d.id" class="rowClass">
          <div class="min-w-0">
            <p class="truncate font-medium text-ink-900" t-out="d.taskTitle"/>
            <p class="text-sm text-ink-500" t-out="reason(d)"/>
          </div>
          <span t-att-class="ageClass(d)"><t t-out="d.ageHours"/>h old</span>
        </Link>
      </div>
    </AdminPage>`;
  static components = { AdminPage, EmptyState, Link };
  static override props = {};

  state = useState<{ disputes: DisputeQueueItem[] | null; error: string | null }>({ disputes: null, error: null });
  cardClass = card('overflow-hidden');
  rowClass =
    'flex items-center justify-between gap-4 border-b border-line px-4 py-4 last:border-b-0 ' +
    'transition-colors duration-micro ease-onsite hover:bg-paper-100';

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  reason(d: DisputeQueueItem): string {
    return d.reason.replace(/_/g, ' ').toLowerCase();
  }

  ageClass(d: DisputeQueueItem): string {
    return `tabular shrink-0 text-sm ${d.ageHours > 48 ? 'font-semibold text-dispute' : 'text-ink-400'}`;
  }

  private async load() {
    try {
      const res = await api.get<{ data: DisputeQueueItem[] }>('/admin/disputes?limit=20');
      if (!this.disposed) this.state.disputes = res.data;
    } catch (error) {
      if (!this.disposed) this.state.error = error instanceof ApiError ? error.message : 'Could not load the dispute queue.';
    }
  }
}
