import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Link } from '@/components/Link';
import { Page } from '@/components/Page';
import type { PayoutAccountView, PayoutRow, PayoutSummary } from '@/lib/api-types';
import { ApiError, api } from '@/services/api';
import { toast } from '@/store/store';
import { btn, card } from '@/ui/classes';
import { PayoutAccountForm } from './payouts/PayoutAccountForm';

interface WorkerStats {
  ratingAvg: number | null;
  ratingCount: number;
  tasksCompleted: number;
  tasksAccepted: number;
  tasksOffered: number;
  completionRate: number | null;
  responseRate: number | null;
}

interface Tile {
  label: string;
  value: string;
  hint?: string;
}

const STATUS: Record<PayoutRow['status'], { label: string; tone: string }> = {
  PENDING: { label: 'Owed', tone: 'bg-progress/10 text-progress' },
  PROCESSING: { label: 'On the way', tone: 'bg-progress/10 text-progress' },
  PROCESSED: { label: 'Paid', tone: 'bg-verified/10 text-verified' },
  FAILED: { label: 'Failed', tone: 'bg-dispute/10 text-dispute' },
  REVERSED: { label: 'Reversed', tone: 'bg-dispute/10 text-dispute' },
};
const BAR = 'skeleton rounded-md';

/**
 * A worker's money: what they are owed, what is on its way and what has been
 * paid; where payouts go; and every payout with its outcome. Item
 * reimbursements are shown apart from earnings, because they are the
 * worker's own money coming back, not income. Money screens stay calm.
 */
export class EarningsView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Earnings &amp; payouts' }]">
      <div class="mx-auto flex max-w-2xl flex-col gap-6">
        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>

        <div t-elif="!state.summary" class="grid grid-cols-3 gap-3" aria-hidden="true">
          <div t-foreach="[0, 1, 2]" t-as="i" t-key="i" t-att-class="tileClass">
            <div class="h-3 w-16 ${BAR}"/><div class="h-7 w-20 ${BAR}"/>
          </div>
        </div>

        <t t-else="">
          <section t-att-class="balanceClass" aria-labelledby="balance-title">
            <h2 id="balance-title" class="sr-only">Balance</h2>
            <div class="grid grid-cols-3 gap-3">
              <div class="flex flex-col gap-1">
                <span class="text-xs font-medium text-ink-500">Ready to pay out</span>
                <span class="tabular text-xl font-bold text-ink-900 sm:text-2xl" t-out="money(state.summary.availablePaise)"/>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs font-medium text-ink-500">On the way</span>
                <span class="tabular text-xl font-bold text-ink-900 sm:text-2xl" t-out="money(state.summary.processingPaise)"/>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs font-medium text-ink-500">Paid to you</span>
                <span class="tabular text-xl font-bold text-verified sm:text-2xl" t-out="money(state.summary.paidPaise)"/>
              </div>
            </div>
            <p class="mt-3 border-t border-line-light pt-3 text-sm text-ink-500">
              Earned from tasks <span class="tabular font-semibold text-ink-900" t-out="money(state.summary.earnedPaise)"/>
              <t t-if="state.summary.reimbursedPaise > 0"> · Items paid back <span class="tabular font-semibold text-ink-900" t-out="money(state.summary.reimbursedPaise)"/></t>
            </p>

            <p t-if="state.summary.provider === 'none'" class="mt-3 rounded-input bg-paper-100 px-3 py-2 text-sm text-ink-700">
              Payouts are not switched on yet. Everything you earn is recorded and will be sent once they are.
            </p>
            <p t-elif="state.summary.failedCount > 0" role="alert" class="mt-3 rounded-input bg-tint-orange px-3 py-2 text-sm text-[#7a3d00]">
              <t t-out="failedText"/>
            </p>

            <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span class="flex min-w-0 items-center gap-2 text-sm text-ink-700">
                <Icon name="state.summary.account ? (state.summary.account.type === 'BANK' ? 'landmark' : 'smartphone') : 'wallet'" size="16"/>
                <span class="truncate" t-out="destinationText"/>
              </span>
              <button t-if="canPayOut" type="button" t-att-class="payClass" t-att-disabled="state.busy" t-on-click="payOut">
                Pay out <t t-out="money(state.summary.availablePaise)"/>
              </button>
            </div>
          </section>

          <section aria-labelledby="accounts-title" class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <h2 id="accounts-title" class="text-lg font-medium text-ink-900">Payout accounts</h2>
              <button t-if="!state.adding and state.accounts.length &lt; 3" type="button" t-att-class="addClass" t-on-click="startAdding">
                <Icon name="'plus'" size="16"/> Add
              </button>
            </div>

            <div t-if="state.adding" t-att-class="formCardClass">
              <PayoutAccountForm onAdded="onAdded" onCancel="stopAdding"/>
            </div>

            <div t-if="state.accounts.length === 0 and !state.adding" t-att-class="formCardClass">
              <p class="text-sm text-ink-700">Add a bank account or UPI ID to receive what you earn. It is checked before any money is sent to it.</p>
              <button type="button" t-att-class="primaryClass + ' mt-3'" t-on-click="startAdding">Add a payout account</button>
            </div>

            <ul t-if="state.accounts.length" t-att-class="listClass">
              <li t-foreach="state.accounts" t-as="a" t-key="a.id" class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 last:border-b-0">
                <div class="flex min-w-0 items-center gap-3">
                  <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-700">
                    <Icon name="a.type === 'BANK' ? 'landmark' : 'smartphone'" size="18"/>
                  </span>
                  <div class="min-w-0">
                    <p class="truncate font-medium text-ink-900" t-out="accountTitle(a)"/>
                    <p class="truncate text-sm text-ink-500" t-out="accountDetail(a)"/>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <span t-if="a.isDefault" class="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-ink-900">Payouts go here</span>
                  <span t-att-class="a.isVerified ? 'rounded-full bg-verified/10 px-2.5 py-1 text-xs font-medium text-verified' : 'rounded-full bg-progress/10 px-2.5 py-1 text-xs font-medium text-progress'"
                    t-out="a.isVerified ? 'Verified' : 'Verification pending'"/>
                  <button t-if="a.isVerified and !a.isDefault" type="button" t-att-class="smallClass" t-att-disabled="state.busy" t-on-click="() => makeDefault(a)">Use for payouts</button>
                  <button type="button" t-att-class="removeClass" t-att-disabled="state.busy" t-att-aria-label="'Remove ' + accountTitle(a)" t-on-click="() => remove(a)">
                    <Icon name="'trash'" size="16"/>
                  </button>
                </div>
              </li>
            </ul>
          </section>

          <section aria-labelledby="history-title">
            <h2 id="history-title" class="mb-3 text-lg font-medium text-ink-900">Payout history</h2>
            <EmptyState t-if="state.payouts.length === 0" title="'No payouts yet'" description="'Complete a task and what you earn will show up here.'"/>
            <div t-else="" t-att-class="listClass">
              <Link t-foreach="state.payouts" t-as="p" t-key="p.id" to="'/tasks/' + p.taskId" class="rowClass">
                <div class="min-w-0">
                  <p class="truncate font-medium text-ink-900" t-out="p.taskTitle"/>
                  <p class="text-sm text-ink-400" t-out="detail(p)"/>
                  <p t-if="p.failureReason" class="text-sm text-dispute" t-out="p.failureReason"/>
                </div>
                <div class="flex shrink-0 flex-col items-end gap-1.5">
                  <span class="tabular font-semibold text-ink-900" t-out="money(p.amountPaise)"/>
                  <span t-att-class="pillClass(p)" t-out="statusLabel(p)"/>
                </div>
              </Link>
            </div>
          </section>

          <section t-if="state.stats" aria-labelledby="stats-title">
            <h2 id="stats-title" class="mb-3 text-lg font-medium text-ink-900">How you are doing</h2>
            <p class="mb-3 text-sm text-ink-500">Every part shown separately, never one opaque score.</p>
            <div class="grid grid-cols-2 gap-3">
              <div t-foreach="tiles" t-as="tile" t-key="tile.label" t-att-class="tileClass">
                <span class="text-sm text-ink-500" t-out="tile.label"/>
                <span class="tabular text-2xl font-semibold text-ink-900" t-out="tile.value"/>
                <span t-if="tile.hint" class="text-xs text-ink-400" t-out="tile.hint"/>
              </div>
            </div>
          </section>
        </t>
      </div>
    </Page>`;
  static components = { EmptyState, Icon, Link, Page, PayoutAccountForm };
  static override props = {};

  state = useState<{
    summary: PayoutSummary | null;
    accounts: PayoutAccountView[];
    payouts: PayoutRow[];
    stats: WorkerStats | null;
    adding: boolean;
    busy: boolean;
    error: string | null;
  }>({ summary: null, accounts: [], payouts: [], stats: null, adding: false, busy: false, error: null });

  balanceClass = card('p-5');
  tileClass = card('flex flex-col gap-1 p-4');
  formCardClass = card('p-5');
  listClass = card('overflow-hidden');
  rowClass =
    'flex items-center justify-between gap-4 border-b border-line px-4 py-4 last:border-b-0 ' +
    'transition-colors duration-micro ease-onsite hover:bg-paper-100';
  payClass = btn('primary');
  primaryClass = btn('primary');
  addClass = btn('secondary', 'sm');
  smallClass = btn('secondary', 'sm');
  // A large target: removing an account is rare but should never be a fiddly tap.
  removeClass = btn('ghost', 'icon', 'text-ink-500 hover:text-dispute');

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  money(paise: number): string {
    return formatPaise(paise);
  }

  get canPayOut(): boolean {
    const s = this.state.summary;
    return Boolean(s && s.provider !== 'none' && s.account && s.availablePaise > 0);
  }

  get destinationText(): string {
    const s = this.state.summary;
    if (!s?.account) return 'No verified payout account yet';
    return `Payouts go to ${s.account.label}`;
  }

  get failedText(): string {
    const count = this.state.summary?.failedCount ?? 0;
    const reason = this.state.payouts.find((p) => p.status === 'FAILED')?.failureReason;
    const lead = count === 1 ? 'A payout did not go through.' : `${count} payouts did not go through.`;
    return `${lead} ${reason ?? ''} Check your account, then tap Pay out. Failed payouts are also retried automatically.`.trim();
  }

  get tiles(): Tile[] {
    const stats = this.state.stats;
    if (!stats) return [];
    return [
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

  accountTitle(a: PayoutAccountView): string {
    return a.type === 'BANK' ? `Bank account ••${(a.accountNumberMasked ?? '').slice(-4)}` : (a.upiVpa ?? 'UPI');
  }

  accountDetail(a: PayoutAccountView): string {
    return a.type === 'BANK' ? [a.accountHolderName, a.ifsc].filter(Boolean).join(' · ') : 'UPI';
  }

  detail(p: PayoutRow): string {
    const date = new Date(p.processedAt ?? p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const parts = [date];
    if (p.reimbursementPaise > 0) {
      parts.push(`${formatPaise(p.earningsPaise)} earned + ${formatPaise(p.reimbursementPaise)} item paid back`);
    }
    if (p.status === 'PROCESSED' && p.destination) parts.push(`to ${p.destination}`);
    if (p.reference) parts.push(`ref ${p.reference}`);
    return parts.join(' · ');
  }

  statusLabel(p: PayoutRow): string {
    return STATUS[p.status].label;
  }

  pillClass(p: PayoutRow): string {
    return `rounded-full px-2.5 py-1 text-xs font-medium ${STATUS[p.status].tone}`;
  }

  startAdding = () => {
    this.state.adding = true;
  };

  stopAdding = () => {
    this.state.adding = false;
  };

  onAdded = async (account: PayoutAccountView) => {
    this.state.adding = false;
    toast(account.isVerified ? 'Payout account added and verified' : 'Payout account added', {
      description: account.isVerified ? 'What you earn is sent here.' : 'It is checked before any money is sent to it.',
      variant: 'success',
    });
    await this.load();
  };

  async makeDefault(a: PayoutAccountView) {
    await this.act(async () => {
      this.state.accounts = await api.patch<PayoutAccountView[]>(`/users/me/payout-accounts/${a.id}/default`);
    });
  }

  async remove(a: PayoutAccountView) {
    if (!window.confirm(`Remove ${this.accountTitle(a)}? Payouts will stop going to it.`)) return;
    await this.act(async () => {
      this.state.accounts = await api.delete<PayoutAccountView[]>(`/users/me/payout-accounts/${a.id}`);
    });
  }

  payOut = async () => {
    await this.act(async () => {
      const summary = await api.post<PayoutSummary>('/payouts/settle');
      toast(summary.failedCount > 0 ? 'Some payouts did not go through' : 'Payout sent', {
        description: summary.failedCount > 0 ? 'See the reason below.' : `On its way to ${summary.account?.label ?? 'your account'}.`,
        variant: summary.failedCount > 0 ? 'default' : 'success',
      });
    });
  };

  private async act(action: () => Promise<void>) {
    this.state.busy = true;
    try {
      await action();
      await this.load();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Something went wrong. Try again.', { variant: 'error' });
    } finally {
      this.state.busy = false;
    }
  }

  private async load() {
    try {
      const [summary, accounts, payouts, stats] = await Promise.all([
        api.get<PayoutSummary>('/payouts/summary'),
        api.get<PayoutAccountView[]>('/users/me/payout-accounts'),
        api.get<{ data: PayoutRow[] }>('/payouts/mine?limit=50'),
        api.get<WorkerStats>('/workers/me/stats').catch(() => null),
      ]);
      if (this.disposed) return;
      this.state.summary = summary;
      this.state.accounts = accounts;
      this.state.payouts = payouts.data;
      this.state.stats = stats;
      this.state.error = null;
    } catch (error) {
      if (!this.disposed) this.state.error = error instanceof ApiError ? error.message : 'Could not load your earnings.';
    }
  }
}
