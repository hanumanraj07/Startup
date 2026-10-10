import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import type { TaskStatus } from '@onsite/types';
import { AdminPage } from '@/components/admin/AdminPage';
import { Link } from '@/components/Link';
import { StatusPill } from '@/components/StatusPill';
import { ApiError, api } from '@/services/api';
import { card } from '@/ui/classes';

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

interface AdminTaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  riskLevel: RiskLevel;
  riskFlags: string[];
  budgetPaise: number;
  createdAt: string;
}

interface Filter {
  value: RiskLevel | null;
  label: string;
}

const RISK_TONE: Record<RiskLevel, string> = {
  LOW: 'bg-paper-100 text-ink-500',
  MEDIUM: 'bg-progress/10 text-progress',
  HIGH: 'bg-dispute/10 text-dispute',
};
const FILTERS: Filter[] = [
  { value: null, label: 'All' },
  { value: 'MEDIUM', label: 'MEDIUM risk' },
  { value: 'HIGH', label: 'HIGH risk' },
];
const BAR = 'animate-pulse rounded bg-paper-100';

/** Every task on the platform, filterable by risk level. */
export class AdminTasksView extends Component {
  static override template = xml`
    <AdminPage breadcrumbs="[{ label: 'Tasks' }]">
      <div class="flex flex-col gap-4">
        <div class="flex gap-2">
          <button t-foreach="filters" t-as="f" t-key="f.label" type="button"
            t-att-class="filterClass(f)" t-att-aria-pressed="state.risk === f.value ? 'true' : 'false'"
            t-on-click="() => setRisk(f.value)" t-out="f.label"/>
        </div>

        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
        <div t-elif="!state.tasks" t-att-class="cardClass" aria-hidden="true">
          <div t-foreach="[0, 1, 2]" t-as="i" t-key="i" class="flex items-center justify-between gap-4 border-b border-line px-4 py-4 last:border-b-0">
            <div class="flex flex-col gap-2"><div class="h-4 w-48 ${BAR}"/><div class="flex gap-2"><div class="h-5 w-20 ${BAR}"/><div class="h-5 w-16 ${BAR}"/></div></div>
            <div class="h-4 w-16 ${BAR}"/>
          </div>
        </div>
        <p t-elif="state.tasks.length === 0" class="text-sm text-ink-400">No tasks match.</p>
        <div t-else="" t-att-class="cardClass">
          <Link t-foreach="state.tasks" t-as="t" t-key="t.id" to="'/admin/tasks/' + t.id" class="rowClass">
            <div class="min-w-0">
              <p class="truncate font-medium text-ink-900" t-out="t.title"/>
              <div class="mt-1 flex items-center gap-2">
                <StatusPill status="t.status"/>
                <span t-att-class="riskClass(t)"><t t-out="riskLabel(t)"/></span>
              </div>
            </div>
            <span class="tabular shrink-0 font-semibold text-ink-900" t-out="budget(t)"/>
          </Link>
        </div>
      </div>
    </AdminPage>`;
  static components = { AdminPage, Link, StatusPill };
  static override props = {};

  state = useState<{ risk: RiskLevel | null; tasks: AdminTaskRow[] | null; error: string | null }>({
    risk: null,
    tasks: null,
    error: null,
  });
  filters = FILTERS;
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

  filterClass(f: Filter): string {
    const tone = this.state.risk === f.value ? 'bg-brand-solid text-white' : 'bg-paper-100 text-ink-500 hover:text-ink-900';
    return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-micro ease-onsite ${tone}`;
  }

  riskClass(t: AdminTaskRow): string {
    return `rounded-full px-2 py-0.5 text-xs font-medium ${RISK_TONE[t.riskLevel]}`;
  }

  riskLabel(t: AdminTaskRow): string {
    return `${t.riskLevel.toLowerCase()} risk`;
  }

  budget(t: AdminTaskRow): string {
    return formatPaise(t.budgetPaise);
  }

  setRisk = (risk: RiskLevel | null) => {
    this.state.risk = risk;
    void this.load();
  };

  private async load() {
    const risk = this.state.risk;
    try {
      const res = await api.get<{ data: AdminTaskRow[] }>(`/admin/tasks?limit=50${risk ? `&riskLevel=${risk}` : ''}`);
      // A slower response for a filter the admin has since left must not overwrite the current one.
      if (this.disposed || this.state.risk !== risk) return;
      this.state.tasks = res.data;
      this.state.error = null;
    } catch (error) {
      if (!this.disposed) this.state.error = error instanceof ApiError ? error.message : 'Could not load tasks.';
    }
  }
}
