import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import type { TaskStatus } from '@onsite/types';
import { AdminPage } from '@/components/admin/AdminPage';
import { EvidenceCard, type AdminProof } from '@/components/admin/EvidenceCard';
import { PartyCard, type AdminParty } from '@/components/admin/PartyCard';
import { Icon } from '@/components/Icon';
import { Link } from '@/components/Link';
import { StatusPill } from '@/components/StatusPill';
import { formatDateTime } from '@/lib/format';
import { routerState } from '@/router/router';
import { ApiError, api } from '@/services/api';
import { card, LINK } from '@/ui/classes';

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

interface AdminTaskDetail {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  categoryName: string;
  cityName: string;
  riskLevel: RiskLevel;
  riskFlags: string[];
  createdAt: string;
  deadlineAt: string;
  location: { latitude: number; longitude: number; address: string };
  money: { budgetPaise: number; commissionPaise: number; workerPayoutPaise: number };
  payment: { status: string; amountPaise: number } | null;
  requester: AdminParty & { id: string };
  assignedWorker: (AdminParty & { id: string }) | null;
  proofs: AdminProof[];
  statusHistory: { toStatus: string; actorRole: string; reason: string | null; createdAt: string }[];
  disputes: { id: string; status: string }[];
}

const RISK_TONE: Record<RiskLevel, string> = {
  LOW: 'bg-paper-100 text-ink-500',
  MEDIUM: 'bg-progress/10 text-progress',
  HIGH: 'bg-dispute/10 text-dispute',
};
const BAR = 'skeleton rounded-md';

/** One task as an admin sees it: risk flags, both parties, the money, the evidence and the full timeline. */
export class AdminTaskDetailView extends Component {
  static override template = xml`
    <AdminPage breadcrumbs="[{ label: 'Tasks', to: '/admin/tasks' }, { label: 'Task' }]">
      <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
      <div t-elif="!state.task" class="flex flex-col gap-4" aria-hidden="true">
        <div t-att-class="cardClass + ' flex flex-col gap-2 p-4'"><div class="h-5 w-1/2 ${BAR}"/><div class="h-3 w-1/3 ${BAR}"/><div class="h-4 w-full ${BAR}"/></div>
      </div>

      <div t-else="" class="flex flex-col gap-4">
        <section t-att-class="cardClass + ' flex flex-col gap-2 p-4'">
          <div class="flex items-center gap-2">
            <StatusPill status="task.status"/>
            <span t-att-class="riskClass"><t t-out="riskLabel"/></span>
          </div>
          <h2 class="text-lg font-medium text-ink-900" t-out="task.title"/>
          <p class="text-sm text-ink-500" t-out="where"/>
          <p class="text-sm text-ink-700" t-out="task.description"/>
          <p t-foreach="task.riskFlags" t-as="flag" t-key="flag" class="flex items-center gap-1 text-xs font-medium text-progress">
            <Icon name="'alert-triangle'" size="12"/> <t t-out="flagLabel(flag)"/>
          </p>
          <div t-if="task.disputes.length > 0" class="flex flex-col gap-1 pt-2">
            <Link t-foreach="task.disputes" t-as="d" t-key="d.id" to="'/admin/disputes/' + d.id" class="linkClass">
              View dispute (<t t-out="disputeStatus(d)"/>)
            </Link>
          </div>
        </section>

        <div class="grid gap-4 sm:grid-cols-2">
          <PartyCard label="'Requester'" party="task.requester"/>
          <PartyCard t-if="task.assignedWorker" label="'Worker'" party="task.assignedWorker"/>
        </div>

        <section t-att-class="cardClass + ' flex flex-col gap-2 p-4 text-sm'">
          <h2 class="text-lg font-medium text-ink-900">Money</h2>
          <div t-foreach="moneyRows" t-as="row" t-key="row.label" class="flex items-center justify-between">
            <span class="text-ink-500" t-out="row.label"/>
            <span class="tabular font-medium text-ink-900" t-out="row.value"/>
          </div>
        </section>

        <div t-if="task.proofs.length > 0">
          <h2 class="mb-3 text-[17px] font-medium text-ink-900">Evidence</h2>
          <div class="grid gap-3 sm:grid-cols-2">
            <EvidenceCard t-foreach="task.proofs" t-as="proof" t-key="proof_index" proof="proof"/>
          </div>
        </div>

        <section t-att-class="cardClass + ' flex flex-col gap-3 p-4'">
          <h2 class="text-lg font-medium text-ink-900">Timeline</h2>
          <div t-foreach="task.statusHistory" t-as="h" t-key="h_index" class="flex flex-col gap-0.5 text-sm">
            <span class="font-medium text-ink-900" t-out="statusLabel(h)"/>
            <span class="tabular text-xs text-ink-400" t-out="when(h)"/>
            <span t-if="h.reason" class="text-xs text-ink-500" t-out="h.reason"/>
          </div>
        </section>
      </div>
    </AdminPage>`;
  static components = { AdminPage, EvidenceCard, Icon, Link, PartyCard, StatusPill };
  static override props = {};

  router = useState(routerState);
  state = useState<{ task: AdminTaskDetail | null; error: string | null }>({ task: null, error: null });
  cardClass = card();
  linkClass = `text-sm ${LINK}`;

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  /** Only read once loaded; the template guards on state.task. */
  get task(): AdminTaskDetail {
    return this.state.task as AdminTaskDetail;
  }

  get riskClass(): string {
    return `rounded-full px-2 py-0.5 text-xs font-medium ${RISK_TONE[this.task.riskLevel]}`;
  }

  get riskLabel(): string {
    return `${this.task.riskLevel.toLowerCase()} risk`;
  }

  get where(): string {
    const t = this.task;
    return `${t.categoryName} · ${t.cityName} · ${t.location.address}`;
  }

  get moneyRows(): { label: string; value: string }[] {
    const { money, payment } = this.task;
    return [
      { label: 'Budget', value: formatPaise(money.budgetPaise) },
      { label: 'Commission', value: formatPaise(money.commissionPaise) },
      { label: 'Worker payout', value: formatPaise(money.workerPayoutPaise) },
      { label: 'Payment status', value: payment ? payment.status.toLowerCase() : 'not funded' },
    ];
  }

  flagLabel(flag: string): string {
    return flag.replace(/_/g, ' ');
  }

  disputeStatus(d: { status: string }): string {
    return d.status.toLowerCase();
  }

  statusLabel(h: { toStatus: string }): string {
    return h.toStatus.replace(/_/g, ' ').toLowerCase();
  }

  when(h: { createdAt: string; actorRole: string }): string {
    return `${formatDateTime(h.createdAt)} · ${h.actorRole.toLowerCase()}`;
  }

  private async load() {
    const id = this.router.params['id'];
    try {
      const task = await api.get<AdminTaskDetail>(`/admin/tasks/${id}`);
      if (!this.disposed) this.state.task = task;
    } catch (error) {
      if (!this.disposed) this.state.error = error instanceof ApiError ? error.message : 'Could not load this task.';
    }
  }
}
