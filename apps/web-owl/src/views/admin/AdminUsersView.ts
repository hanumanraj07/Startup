import { Component, useState, xml } from '@odoo/owl';
import { AdminPage } from '@/components/admin/AdminPage';
import { Icon } from '@/components/Icon';
import { ApiError, api } from '@/services/api';
import { btn, card, input } from '@/ui/classes';

interface AdminUserRow {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  status: string;
  platformRole: string;
  verificationLevel: number;
  createdAt: string;
}

/** Suspension needs a stated reason of at least 10 characters, and an admin cannot be suspended here. */
const MIN_REASON = 10;

/** User search and suspension. Contact details are shown here because this is the admin console, nowhere else. */
export class AdminUsersView extends Component {
  static override template = xml`
    <AdminPage breadcrumbs="[{ label: 'Users' }]">
      <div class="flex flex-col gap-4">
        <form class="flex gap-2" t-on-submit.prevent="search">
          <input t-att-class="searchClass" type="text" placeholder="Search by name, email or phone" aria-label="Search users"
            t-att-value="state.query" t-on-input="onQuery"/>
          <button type="submit" t-att-class="searchBtnClass" t-att-disabled="state.loading">
            <span t-if="state.loading" class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" aria-hidden="true"/>
            <Icon t-else="" name="'search'" size="16"/> Search
          </button>
        </form>

        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
        <p t-if="state.results and state.results.length === 0" class="text-sm text-ink-400">No matches.</p>

        <div t-foreach="state.results or []" t-as="u" t-key="u.id" t-att-class="cardClass">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="font-medium text-ink-900"><t t-out="u.displayName"/> <span class="text-sm font-normal text-ink-400">(<t t-out="u.platformRole"/>)</span></p>
              <p class="text-sm text-ink-500" t-out="contact(u)"/>
            </div>
            <span t-att-class="statusClass(u)" t-out="statusLabel(u)"/>
          </div>
          <div t-if="canSuspend(u)" class="flex items-center gap-2">
            <textarea t-att-class="reasonClass" rows="1" placeholder="Reason for suspension" aria-label="Reason for suspension"
              t-att-value="reasonFor(u)" t-on-input="(ev) => setReason(u.id, ev)"/>
            <button type="button" t-att-class="suspendClass" t-att-disabled="!hasReason(u) or state.suspendingId === u.id" t-on-click="() => suspend(u.id)">Suspend</button>
          </div>
        </div>
      </div>
    </AdminPage>`;
  static components = { AdminPage, Icon };
  static override props = {};

  state = useState<{
    query: string;
    results: AdminUserRow[] | null;
    loading: boolean;
    error: string | null;
    suspendingId: string | null;
    reasons: Record<string, string>;
  }>({ query: '', results: null, loading: false, error: null, suspendingId: null, reasons: {} });

  searchClass = input(false, 'max-w-sm');
  searchBtnClass = btn('primary');
  cardClass = card('flex flex-col gap-3 p-4');
  reasonClass = input(false, 'min-h-0 py-2');
  suspendClass = btn('destructive', 'sm');

  contact(u: AdminUserRow): string {
    return `${u.email}${u.phone ? ` · ${u.phone}` : ''} · level ${u.verificationLevel}`;
  }

  statusLabel(u: AdminUserRow): string {
    return u.status.toLowerCase();
  }

  statusClass(u: AdminUserRow): string {
    const tone = u.status === 'SUSPENDED' ? 'bg-dispute/10 text-dispute' : 'bg-verified/10 text-verified';
    return `rounded-full px-2.5 py-1 text-xs font-medium ${tone}`;
  }

  canSuspend(u: AdminUserRow): boolean {
    return u.status !== 'SUSPENDED' && u.platformRole !== 'ADMIN';
  }

  reasonFor(u: AdminUserRow): string {
    return this.state.reasons[u.id] ?? '';
  }

  hasReason(u: AdminUserRow): boolean {
    return this.reasonFor(u).trim().length >= MIN_REASON;
  }

  onQuery = (ev: Event) => {
    this.state.query = (ev.target as HTMLInputElement).value;
  };

  setReason = (id: string, ev: Event) => {
    this.state.reasons[id] = (ev.target as HTMLTextAreaElement).value;
  };

  search = async () => {
    const { state } = this;
    state.loading = true;
    state.error = null;
    try {
      const res = await api.get<{ data: AdminUserRow[] }>(`/admin/users?q=${encodeURIComponent(state.query)}&limit=20`);
      state.results = res.data;
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : 'Search failed.';
    } finally {
      state.loading = false;
    }
  };

  suspend = async (id: string) => {
    const { state } = this;
    state.suspendingId = id;
    state.error = null;
    try {
      await api.post(`/admin/users/${id}/suspend`, { reason: state.reasons[id] });
      state.results = state.results?.map((r) => (r.id === id ? { ...r, status: 'SUSPENDED' } : r)) ?? null;
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : 'Could not suspend this user.';
    } finally {
      state.suspendingId = null;
    }
  };
}
