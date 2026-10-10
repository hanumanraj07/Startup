import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import type { PayoutStatus } from '@onsite/types';
import { EmptyState } from '@/components/EmptyState';
import { Link } from '@/components/Link';
import { Page } from '@/components/Page';
import { ApiError, api } from '@/services/api';
import { card } from '@/ui/classes';

interface WorkerStats {
  ratingAvg: number | null;
  ratingCount: number;
  tasksCompleted: number;
  tasksAccepted: number;
  tasksOffered: number;
  completionRate: number | null;
  responseRate: number | null;
}

interface PayoutRow {
  id: string;
  taskId: string;
  taskTitle: string;
  amountPaise: number;
  status: PayoutStatus;
  processedAt: string | null;
  createdAt: string;
}

interface Tile {
  label: string;
  value: string;
  hint?: string;
}

const STATUS_TONE: Record<PayoutStatus, string> = {
  PENDING: 'bg-progress/10 text-progress',
  PROCESSING: 'bg-progress/10 text-progress',
  PROCESSED: 'bg-verified/10 text-verified',
  FAILED: 'bg-dispute/10 text-dispute',
  REVERSED: 'bg-dispute/10 text-dispute',
};
const BAR = 'animate-pulse rounded bg-paper-100';

/** A worker's stats and payout history. Every component shown separately, never one opaque score. */
export class EarningsView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Earnings' }]">
      <div class="mx-auto flex max-w-2xl flex-col gap-6">
        <p class="text-sm text-ink-500">Every component shown separately — never one opaque score.</p>

        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>

        <div t-elif="!state.stats or !state.payouts" class="grid grid-cols-2 gap-4" aria-hidden="true">
          <div t-foreach="[0, 1, 2, 3, 4, 5]" t-as="i" t-key="i" t-att-class="tileClass">
            <div class="h-3 w-20 ${BAR}"/><div class="h-7 w-16 ${BAR}"/>
          </div>
        </div>

        <t t-else="">
          <div class="grid grid-cols-2 gap-4">
            <div t-foreach="tiles" t-as="tile" t-key="tile.label" t-att-class="tileClass">
              <span class="text-sm text-ink-500" t-out="tile.label"/>
              <span class="tabular text-2xl font-semibold text-ink-900" t-out="tile.value"/>
              <span t-if="tile.hint" class="text-xs text-ink-400" t-out="tile.hint"/>
            </div>
          </div>

          <div>
            <h2 class="mb-3 text-lg font-medium text-ink-900">Payout history</h2>
            <EmptyState t-if="state.payouts.length === 0" title="'No payouts yet'" description="'Complete a task and its payout will show up here.'"/>
            <div t-else="" t-att-class="listClass">
              <Link t-foreach="state.payouts" t-as="p" t-key="p.id" to="'/tasks/' + p.taskId" class="rowClass">
                <div class="min-w-0">
                  <p class="truncate font-medium text-ink-900" t-out="p.taskTitle"/>
                  <p class="text-sm text-ink-400" t-out="date(p)"/>
                </div>
                <div class="flex shrink-0 items-center gap-3">
                  <span class="tabular font-semibold text-verified" t-out="amount(p)"/>
                  <span t-att-class="pillClass(p)" t-out="statusLabel(p)"/>
                </div>
              </Link>
            </div>
          </div>
        </t>
      </div>
    </Page>`;
  static components = { EmptyState, Link, Page };
  static override props = {};

  state = useState<{ stats: WorkerStats | null; payouts: PayoutRow[] | null; error: string | null }>({
    stats: null,
    payouts: null,
    error: null,
  });
  tileClass = card('flex flex-col gap-1 p-4');
  listClass = card('overflow-hidden');
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

  get tiles(): Tile[] {
    const { stats, payouts } = this.state;
    if (!stats || !payouts) return [];
    const total = payouts.reduce((sum, p) => sum + p.amountPaise, 0);
    const paid = payouts.filter((p) => p.status === 'PROCESSED').reduce((sum, p) => sum + p.amountPaise, 0);
    return [
      { label: 'Total earned', value: formatPaise(total) },
      { label: 'Paid out', value: formatPaise(paid) },
      {
        label: 'Rating',
        value: stats.ratingAvg !== null ? `${stats.ratingAvg.toFixed(1)} ★` : 'No ratings yet',
        hint: stats.ratingCount > 0 ? `from ${stats.ratingCount} tasks` : undefined,
      },
      { label: 'Tasks completed', value: String(stats.tasksCompleted) },
      { label: 'Completion rate', value: stats.completionRate !== null ? `${Math.round(stats.completionRate)}%` : '—' },
      { label: 'Response rate', value: stats.responseRate !== null ? `${Math.round(stats.responseRate)}%` : '—' },
    ];
  }

  amount(p: PayoutRow): string {
    return formatPaise(p.amountPaise);
  }

  date(p: PayoutRow): string {
    return new Date(p.processedAt ?? p.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  statusLabel(p: PayoutRow): string {
    return p.status.toLowerCase();
  }

  pillClass(p: PayoutRow): string {
    return `rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[p.status]}`;
  }

  private async load() {
    try {
      const [stats, payouts] = await Promise.all([
        api.get<WorkerStats>('/workers/me/stats'),
        api.get<{ data: PayoutRow[] }>('/payouts/mine?limit=50'),
      ]);
      if (this.disposed) return;
      this.state.stats = stats;
      this.state.payouts = payouts.data;
    } catch (error) {
      if (!this.disposed) this.state.error = error instanceof ApiError ? error.message : 'Could not load your earnings.';
    }
  }
}
