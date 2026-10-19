import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { AdminPage } from '@/components/admin/AdminPage';
import { EmptyState } from '@/components/EmptyState';
import { Tabs } from '@/components/Tabs';
import { formatDateTime } from '@/lib/format';
import { ApiError, api } from '@/services/api';
import { btn, card, input } from '@/ui/classes';

type View = 'PENDING' | 'ALL';
type Decision = 'UPHOLD' | 'OVERTURN';

interface ModerationItem {
  id: string;
  user: { id: string; displayName: string; email: string };
  stage: string;
  title: string;
  description: string;
  source: 'RULES' | 'AI';
  reason: string;
  categories: string[];
  createdAt: string;
  restrictedUntil: string;
  appealStatus: 'NONE' | 'PENDING' | 'UPHELD' | 'OVERTURNED';
  appealNote: string | null;
  appealedAt: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  blocksLast24h: number;
}

const BAR = 'skeleton rounded-md';

const APPEAL_LABEL: Record<ModerationItem['appealStatus'], string> = {
  NONE: 'No appeal',
  PENDING: 'Appeal waiting',
  UPHELD: 'Block upheld',
  OVERTURNED: 'Overturned',
};

/**
 * Blocked tasks and the appeals against them. Overturning lifts the user's
 * posting pause at once and lets that exact text through for them; upholding
 * keeps the block. Either needs a note, and both are audited by the API.
 * Calm and functional: the content is shown exactly as it was written.
 */
export class AdminModerationView extends Component {
  static override template = xml`
    <AdminPage breadcrumbs="[{ label: 'Moderation' }]">
      <div class="mb-4"><Tabs tabs="tabs" value="state.view" onChange="setView"/></div>
      <p t-if="state.error" role="alert" class="mb-3 text-sm text-dispute" t-out="state.error"/>

      <div t-if="!state.items and !state.loadFailed" class="flex flex-col gap-4" aria-hidden="true">
        <div t-foreach="[0, 1]" t-as="i" t-key="i" t-att-class="itemClass">
          <div class="h-4 w-40 ${BAR}"/><div class="h-3 w-full ${BAR}"/><div class="h-3 w-2/3 ${BAR}"/>
        </div>
      </div>
      <EmptyState t-elif="state.items and state.items.length === 0"
        title="state.view === 'PENDING' ? 'No appeals waiting' : 'Nothing blocked yet'"
        description="state.view === 'PENDING' ? 'When someone asks for a blocked task to be reviewed, it appears here.' : 'Blocked tasks will be listed here.'"/>
      <div t-elif="state.items" class="flex flex-col gap-4">
        <article t-foreach="state.items" t-as="item" t-key="item.id" t-att-class="itemClass">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-medium text-ink-900" t-out="item.user.displayName"/>
              <p class="truncate text-sm text-ink-500" t-out="item.user.email"/>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="rounded-full bg-dispute/10 px-2.5 py-1 font-semibold text-[#a3241a]" t-out="item.reason"/>
              <span class="rounded-full bg-paper-100 px-2.5 py-1 font-medium text-ink-700" t-out="item.source === 'AI' ? 'Caught by AI' : 'Caught by rules'"/>
              <span t-if="item.blocksLast24h > 1" class="rounded-full bg-tint-orange px-2.5 py-1 font-semibold text-[#7a3d00]">
                <t t-out="item.blocksLast24h"/> blocks in 24h
              </span>
            </div>
          </div>

          <div class="rounded-input border border-line bg-paper-50 p-3">
            <p class="font-semibold text-ink-900" t-out="item.title"/>
            <p class="mt-1 whitespace-pre-wrap text-sm text-ink-700" t-out="item.description"/>
          </div>

          <p class="text-xs text-ink-400">
            <t t-out="when(item.createdAt)"/> · <t t-out="item.stage.toLowerCase()"/> · <t t-out="appealLabel(item)"/>
          </p>

          <div t-if="item.appealNote" class="rounded-input bg-tint-blue p-3 text-sm text-ink-900">
            <span class="font-semibold">Their explanation: </span><t t-out="item.appealNote"/>
          </div>
          <p t-if="item.reviewNote" class="text-sm text-ink-500">Review note: <t t-out="item.reviewNote"/></p>

          <t t-if="item.appealStatus === 'NONE' or item.appealStatus === 'PENDING'">
            <textarea t-att-class="areaClass" rows="2" aria-label="Decision note" placeholder="Why (required, recorded in the audit log)"
              t-att-value="noteFor(item)" t-on-input="(ev) => setNote(item.id, ev)"/>
            <div class="flex flex-wrap gap-2">
              <button type="button" t-att-class="overturnClass" t-att-disabled="isBusy(item) or !hasNote(item)"
                t-on-click="() => decide(item.id, 'OVERTURN')">Overturn: allow this task</button>
              <button type="button" t-att-class="upholdClass" t-att-disabled="isBusy(item) or !hasNote(item)"
                t-on-click="() => decide(item.id, 'UPHOLD')">Uphold the block</button>
            </div>
          </t>
        </article>
      </div>
    </AdminPage>`;
  static components = { AdminPage, EmptyState, Tabs };
  static override props = {};

  state = useState<{
    view: View;
    items: ModerationItem[] | null;
    loadFailed: boolean;
    error: string | null;
    busyId: string | null;
    notes: Record<string, string>;
  }>({ view: 'PENDING', items: null, loadFailed: false, error: null, busyId: null, notes: {} });

  tabs = [
    { value: 'PENDING', label: 'Appeals' },
    { value: 'ALL', label: 'All blocks' },
  ];
  itemClass = card('flex flex-col gap-3 p-4');
  areaClass = input(false, 'min-h-[56px] py-2');
  overturnClass = btn('secondary');
  upholdClass = btn('dark');

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  when(iso: string): string {
    return formatDateTime(iso);
  }

  appealLabel(item: ModerationItem): string {
    return APPEAL_LABEL[item.appealStatus];
  }

  noteFor(item: ModerationItem): string {
    return this.state.notes[item.id] ?? '';
  }

  hasNote(item: ModerationItem): boolean {
    return this.noteFor(item).trim().length >= 5;
  }

  isBusy(item: ModerationItem): boolean {
    return this.state.busyId === item.id;
  }

  setNote = (id: string, ev: Event) => {
    this.state.notes[id] = (ev.target as HTMLTextAreaElement).value;
  };

  setView = (view: string) => {
    this.state.view = view as View;
    this.state.items = null;
    void this.load();
  };

  private async load() {
    try {
      const res = await api.get<{ data: ModerationItem[] }>(`/admin/moderation?status=${this.state.view}&limit=30`);
      if (!this.disposed) this.state.items = res.data;
    } catch (error) {
      if (!this.disposed) {
        this.state.loadFailed = true;
        this.state.error = error instanceof ApiError ? error.message : 'Could not load the moderation queue.';
      }
    }
  }

  decide = async (id: string, decision: Decision) => {
    const { state } = this;
    state.busyId = id;
    state.error = null;
    try {
      await api.post(`/admin/moderation/${id}/decision`, { decision, note: this.noteFor({ id } as ModerationItem).trim() });
      await this.load();
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : 'Could not record that decision.';
    } finally {
      state.busyId = null;
    }
  };
}
