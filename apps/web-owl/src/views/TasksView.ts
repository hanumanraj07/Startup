import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { CategoryBadge } from '@/components/CategoryBadge';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Link } from '@/components/Link';
import { Page } from '@/components/Page';
import { StatusPill } from '@/components/StatusPill';
import { Tabs, type TabItem } from '@/components/Tabs';
import type { TaskListItem } from '@/lib/api-types';
import { formatDueDate } from '@/lib/format';
import { navigate } from '@/router/router';
import { api } from '@/services/api';
import { store } from '@/store/store';
import { btn, card, tappableCard } from '@/ui/classes';

type Perspective = 'requester' | 'worker';

const POLL_MS = 20_000;
const TABS: TabItem[] = [
  { value: 'requester', label: 'Posted by me' },
  { value: 'worker', label: 'I’m working on' },
];
const BAR = 'skeleton rounded-md';

/**
 * Everything the user has posted or accepted. Polls lightly while visible: a
 * task's own page gets task:status pushes, but this list has no equivalent
 * push channel yet.
 */
export class TasksView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'My tasks' }]">
      <t t-set-slot="actions">
        <Link to="'/tasks/new'" class="postClass">Post a task</Link>
      </t>

      <div class="flex flex-col gap-4">
        <p class="text-sm text-ink-500">Everything you’ve posted or accepted, in one place.</p>

        <div t-if="user and user.hasWorkerProfile">
          <Tabs tabs="tabs" value="state.perspective" onChange="setPerspective"/>
        </div>

        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>

        <div t-if="!state.tasks" class="flex flex-col gap-3" aria-hidden="true">
          <div t-foreach="[0, 1, 2]" t-as="i" t-key="i" t-att-class="skeletonClass">
            <div class="skeleton h-11 w-11 shrink-0 rounded-[30%]"/>
            <div class="flex flex-1 flex-col gap-2"><div class="h-4 w-3/5 ${BAR}"/><div class="h-3 w-24 ${BAR}"/></div>
            <div class="flex flex-col items-end gap-2"><div class="skeleton h-6 w-20 rounded-full"/><div class="h-4 w-14 ${BAR}"/></div>
          </div>
        </div>
        <EmptyState t-elif="state.tasks.length === 0" title="emptyTitle" description="emptyDescription"/>
        <ul t-else="" class="flex flex-col gap-3">
          <li t-foreach="state.tasks" t-as="task" t-key="task.id" t-att-class="rowClass" t-on-click="(ev) => open(ev, task.id)">
            <CategoryBadge slug="task.categorySlug" size="44"/>
            <div class="min-w-0 flex-1">
              <Link to="'/tasks/' + task.id" class="linkClass"><t t-out="task.title"/></Link>
              <p class="mt-0.5 flex items-center gap-1 text-sm text-ink-500"><Icon name="'clock'" size="14"/> <t t-out="due(task)"/></p>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1.5">
              <StatusPill status="task.status"/>
              <span class="tabular text-[15px] font-bold text-ink-900" t-out="budget(task)"/>
            </div>
          </li>
        </ul>
      </div>
    </Page>`;
  static components = { CategoryBadge, EmptyState, Icon, Link, Page, StatusPill, Tabs };
  static override props = {};

  store = useState(store);
  state = useState<{ perspective: Perspective; tasks: TaskListItem[] | null; error: string | null }>({
    perspective: 'requester',
    tasks: null,
    error: null,
  });

  tabs = TABS;
  postClass = btn('primary', 'sm');
  rowClass = tappableCard('flex cursor-pointer items-center gap-3 p-4');
  skeletonClass = card('flex items-center gap-3 p-4');
  linkClass = 'line-clamp-2 font-bold leading-snug text-ink-900 hover:underline';

  private disposed = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  override setup() {
    onMounted(() => {
      void this.load();
      this.pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') void this.load();
      }, POLL_MS);
    });
    onWillUnmount(() => {
      this.disposed = true;
      if (this.pollTimer) clearInterval(this.pollTimer);
    });
  }

  get user() {
    return this.store.user;
  }

  get emptyTitle(): string {
    return this.state.perspective === 'requester' ? 'Nothing posted yet' : 'Nothing accepted yet';
  }

  get emptyDescription(): string {
    return this.state.perspective === 'requester'
      ? 'Post your first task to get started.'
      : 'Tasks you accept from the feed will show up here.';
  }

  due(task: TaskListItem): string {
    return `Due ${formatDueDate(task.deadlineAt)}`;
  }

  budget(task: TaskListItem): string {
    return formatPaise(task.amountPaise);
  }

  /** The whole row is clickable; a click on the title link is already handled by the link itself. */
  open(ev: MouseEvent, taskId: string) {
    if ((ev.target as HTMLElement).closest('a')) return;
    navigate(`/tasks/${taskId}`);
  }

  setPerspective = (value: string) => {
    this.state.perspective = value as Perspective;
    this.state.tasks = null;
    void this.load();
  };

  private async load() {
    const perspective = this.state.perspective;
    try {
      const res = await api.get<{ data: TaskListItem[] }>(`/tasks/mine?perspective=${perspective}&limit=50`);
      // A slower response for a tab the user has since left must not overwrite the current one.
      if (this.disposed || this.state.perspective !== perspective) return;
      this.state.tasks = res.data;
      this.state.error = null;
    } catch {
      if (!this.disposed) this.state.error = 'Could not load your tasks.';
    }
  }
}
