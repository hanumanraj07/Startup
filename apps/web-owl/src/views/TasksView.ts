import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { EmptyState } from '@/components/EmptyState';
import { Link } from '@/components/Link';
import { Page } from '@/components/Page';
import { StatusPill } from '@/components/StatusPill';
import { Tabs, type TabItem } from '@/components/Tabs';
import type { TaskListItem } from '@/lib/api-types';
import { formatDueDate } from '@/lib/format';
import { navigate } from '@/router/router';
import { api } from '@/services/api';
import { store } from '@/store/store';
import { btn, card, LINK } from '@/ui/classes';

type Perspective = 'requester' | 'worker';

const POLL_MS = 20_000;
const TABS: TabItem[] = [
  { value: 'requester', label: 'Posted by me' },
  { value: 'worker', label: 'I’m working on' },
];
const BAR = 'animate-pulse rounded bg-paper-100';

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

        <div t-if="!state.tasks" t-att-class="cardClass" aria-hidden="true">
          <div t-foreach="[0, 1, 2]" t-as="i" t-key="i" class="flex items-center justify-between gap-4 border-b border-line px-4 py-4 last:border-b-0">
            <div class="flex flex-col gap-2"><div class="h-4 w-40 ${BAR}"/><div class="h-3 w-24 ${BAR}"/></div>
            <div class="flex flex-col items-end gap-2"><div class="h-5 w-20 ${BAR}"/><div class="h-3 w-14 ${BAR}"/></div>
          </div>
        </div>
        <EmptyState t-elif="state.tasks.length === 0" title="emptyTitle" description="emptyDescription"/>
        <div t-else="" t-att-class="cardClass">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-line bg-paper-100 text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" class="px-4 py-2.5 font-medium">Task</th>
                <th scope="col" class="hidden px-4 py-2.5 font-medium sm:table-cell">Due</th>
                <th scope="col" class="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" class="px-4 py-2.5 text-right font-medium">Budget</th>
              </tr>
            </thead>
            <tbody>
              <tr t-foreach="state.tasks" t-as="task" t-key="task.id"
                class="cursor-pointer border-b border-line transition-colors duration-micro ease-onsite last:border-b-0 hover:bg-paper-100"
                t-on-click="(ev) => open(ev, task.id)">
                <td class="px-4 py-3">
                  <Link to="'/tasks/' + task.id" class="linkClass"><t t-out="task.title"/></Link>
                </td>
                <td class="hidden px-4 py-3 text-ink-500 sm:table-cell"><t t-out="due(task)"/></td>
                <td class="px-4 py-3"><StatusPill status="task.status"/></td>
                <td class="tabular px-4 py-3 text-right text-ink-700"><t t-out="budget(task)"/></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Page>`;
  static components = { EmptyState, Link, Page, StatusPill, Tabs };
  static override props = {};

  store = useState(store);
  state = useState<{ perspective: Perspective; tasks: TaskListItem[] | null; error: string | null }>({
    perspective: 'requester',
    tasks: null,
    error: null,
  });

  tabs = TABS;
  postClass = btn('primary', 'sm');
  cardClass = card('overflow-hidden');
  linkClass = `font-medium ${LINK}`;

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
    return formatPaise(task.budgetPaise);
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
