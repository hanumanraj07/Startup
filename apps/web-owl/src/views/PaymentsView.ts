import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import type { PaymentStatus } from '@onsite/types';
import { EmptyState } from '@/components/EmptyState';
import { Link } from '@/components/Link';
import { Page } from '@/components/Page';
import { ApiError, api } from '@/services/api';
import { card } from '@/ui/classes';

interface PaymentRow {
  id: string;
  taskId: string;
  taskTitle: string;
  status: PaymentStatus;
  amountPaise: number;
  capturedAt: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<PaymentStatus, string> = {
  CREATED: 'bg-paper-100 text-ink-500',
  AUTHORIZED: 'bg-progress/10 text-progress',
  CAPTURED: 'bg-progress/10 text-progress',
  HELD: 'bg-progress/10 text-progress',
  RELEASED: 'bg-verified/10 text-verified',
  REFUNDED: 'bg-paper-100 text-ink-500',
  PARTIALLY_REFUNDED: 'bg-paper-100 text-ink-500',
  FAILED: 'bg-dispute/10 text-dispute',
};
const BAR = 'skeleton rounded-md';

/** Every task the user has funded and where the money stands. A calm money screen: no motion beyond hover. */
export class PaymentsView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Payment history' }]">
      <div class="mx-auto flex max-w-2xl flex-col gap-4">
        <p class="text-sm text-ink-500">Every task you’ve funded, and where the money stands.</p>

        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
        <div t-elif="!state.payments" t-att-class="cardClass" aria-hidden="true">
          <div t-foreach="[0, 1, 2]" t-as="i" t-key="i" class="flex items-center justify-between gap-4 border-b border-line px-4 py-4 last:border-b-0">
            <div class="flex flex-col gap-2"><div class="h-4 w-40 ${BAR}"/><div class="h-3 w-24 ${BAR}"/></div>
            <div class="flex items-center gap-3"><div class="h-4 w-16 ${BAR}"/><div class="h-6 w-20 ${BAR}"/></div>
          </div>
        </div>
        <EmptyState t-elif="state.payments.length === 0" title="'No payments yet'" description="'Fund a task and it will show up here.'"/>
        <div t-else="" t-att-class="cardClass">
          <Link t-foreach="state.payments" t-as="p" t-key="p.id" to="'/tasks/' + p.taskId" class="rowClass">
            <div class="min-w-0">
              <p class="truncate font-medium text-ink-900" t-out="p.taskTitle"/>
              <p class="text-sm text-ink-400" t-out="date(p)"/>
            </div>
            <div class="flex shrink-0 items-center gap-3">
              <span class="tabular font-semibold text-ink-900" t-out="amount(p)"/>
              <span t-att-class="pillClass(p)" t-out="statusLabel(p)"/>
            </div>
          </Link>
        </div>
      </div>
    </Page>`;
  static components = { EmptyState, Link, Page };
  static override props = {};

  state = useState<{ payments: PaymentRow[] | null; error: string | null }>({ payments: null, error: null });
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

  amount(p: PaymentRow): string {
    return formatPaise(p.amountPaise);
  }

  date(p: PaymentRow): string {
    return new Date(p.capturedAt ?? p.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  statusLabel(p: PaymentRow): string {
    return p.status.replace(/_/g, ' ').toLowerCase();
  }

  pillClass(p: PaymentRow): string {
    return `rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[p.status]}`;
  }

  private async load() {
    try {
      const res = await api.get<{ data: PaymentRow[] }>('/payments/mine?limit=50');
      if (!this.disposed) this.state.payments = res.data;
    } catch (error) {
      if (!this.disposed) {
        this.state.error = error instanceof ApiError ? error.message : 'Could not load your payment history.';
      }
    }
  }
}
