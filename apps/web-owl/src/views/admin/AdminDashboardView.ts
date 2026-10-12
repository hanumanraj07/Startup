import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { AdminPage } from '@/components/admin/AdminPage';
import { ApiError, api } from '@/services/api';
import { card } from '@/ui/classes';

interface DashboardMetrics {
  usersTotal: number;
  activeWorkers: number;
  verifiedL2Plus: number;
  tasksToday: number;
  completedToday: number;
  inProgress: number;
  disputesOpen: number;
  completionRate: number | null;
  medianTimeToMatchMinutes: number | null;
  acceptanceRate: number | null;
  gmvTodayPaise: number;
  commissionTodayPaise: number;
  pendingPayoutsPaise: number;
  kycQueueCount: number;
  flaggedTasks: number;
  safetyReports: number;
  byCity: { city: string; tasksToday: number }[];
}

interface Stat {
  label: string;
  value: string;
  /** Draw attention: a queue that needs a human. */
  highlight?: boolean;
  /** The three headline ratios are shown larger. */
  emphasize?: boolean;
}

const BAR = 'skeleton rounded-md';
const percent = (v: number | null) => (v !== null ? `${v}%` : '—');

/** Platform health at a glance. Every figure is computed by the API; this only lays them out. */
export class AdminDashboardView extends Component {
  static override template = xml`
    <AdminPage>
      <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>

      <div t-elif="!state.metrics" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
        <div t-foreach="[0, 1, 2, 3, 4, 5, 6, 7]" t-as="i" t-key="i" t-att-class="tileClass">
          <div class="h-3 w-20 ${BAR}"/><div class="h-6 w-16 ${BAR}"/>
        </div>
      </div>

      <div t-else="" class="flex flex-col gap-6">
        <div t-foreach="groups" t-as="group" t-key="group_index" t-att-class="group.cols">
          <div t-foreach="group.stats" t-as="stat" t-key="stat.label" t-att-class="tileClass">
            <span class="text-sm text-ink-500" t-out="stat.label"/>
            <span t-att-class="valueClass(stat)" t-out="stat.value"/>
          </div>
        </div>

        <div t-if="state.metrics.byCity.length > 0">
          <h2 class="mb-3 text-[17px] font-medium text-ink-900">Tasks today, by city</h2>
          <div t-att-class="listClass">
            <div t-foreach="state.metrics.byCity" t-as="row" t-key="row.city" class="flex items-center justify-between border-b border-line px-4 py-3 text-sm last:border-b-0">
              <span class="text-ink-700" t-out="row.city"/>
              <span class="tabular font-medium text-ink-900" t-out="row.tasksToday"/>
            </div>
          </div>
        </div>
      </div>
    </AdminPage>`;
  static components = { AdminPage };
  static override props = {};

  state = useState<{ metrics: DashboardMetrics | null; error: string | null }>({ metrics: null, error: null });
  tileClass = card('flex flex-col gap-1 p-4');
  listClass = card('overflow-hidden');

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  get groups(): { cols: string; stats: Stat[] }[] {
    const m = this.state.metrics;
    if (!m) return [];
    return [
      {
        cols: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4',
        stats: [
          { label: 'Users', value: String(m.usersTotal) },
          { label: 'Tasks today', value: String(m.tasksToday) },
          { label: 'Active workers', value: String(m.activeWorkers) },
          { label: 'Completed today', value: String(m.completedToday) },
          { label: 'Verified (L2+)', value: String(m.verifiedL2Plus) },
          { label: 'In progress', value: String(m.inProgress) },
          { label: 'Disputed', value: String(m.disputesOpen), highlight: m.disputesOpen > 0 },
          { label: 'Safety reports', value: String(m.safetyReports), highlight: m.safetyReports > 0 },
        ],
      },
      {
        cols: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3',
        stats: [
          { label: 'Completion rate', value: percent(m.completionRate), emphasize: true },
          {
            label: 'Median time to match',
            value: m.medianTimeToMatchMinutes !== null ? `${m.medianTimeToMatchMinutes}m` : '—',
            emphasize: true,
          },
          { label: 'Acceptance rate', value: percent(m.acceptanceRate), emphasize: true },
        ],
      },
      {
        cols: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4',
        stats: [
          { label: 'GMV today', value: formatPaise(m.gmvTodayPaise) },
          { label: 'Commission today', value: formatPaise(m.commissionTodayPaise) },
          { label: 'Pending payouts', value: formatPaise(m.pendingPayoutsPaise) },
          { label: 'KYC queue', value: String(m.kycQueueCount), highlight: m.kycQueueCount > 0 },
          { label: 'Flagged tasks', value: String(m.flaggedTasks), highlight: m.flaggedTasks > 0 },
        ],
      },
    ];
  }

  valueClass(stat: Stat): string {
    const size = stat.emphasize ? 'text-3xl' : 'text-2xl';
    return `tabular font-semibold ${size} ${stat.highlight ? 'text-dispute' : 'text-ink-900'}`;
  }

  private async load() {
    try {
      const metrics = await api.get<DashboardMetrics>('/admin/metrics');
      if (!this.disposed) this.state.metrics = metrics;
    } catch (error) {
      if (!this.disposed) {
        this.state.error = error instanceof ApiError ? error.message : 'Could not load dashboard metrics.';
      }
    }
  }
}
