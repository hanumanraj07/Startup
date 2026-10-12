import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Link } from '@/components/Link';
import { Page } from '@/components/Page';
import { Switch } from '@/components/Switch';
import { TaskCard, TaskCardSkeleton } from '@/components/TaskCard';
import type { CategoryView, FeedTask, RawFeedItem, WorkerProfile } from '@/lib/api-types';
import { radiusKm } from '@/lib/format';
import { navigate } from '@/router/router';
import { ApiError, api } from '@/services/api';
import { store, toast } from '@/store/store';
import { LINK } from '@/ui/classes';

const POLL_MS = 20_000;

interface FeedState {
  profile: WorkerProfile | null;
  tasks: FeedTask[] | null;
  error: string | null;
  acceptingId: string | null;
  actionError: string | null;
}

export class FeedView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Nearby tasks' }]">
      <t t-set-slot="actions">
        <label t-if="state.profile" class="flex items-center gap-2 text-sm text-ink-700">
          <t t-out="state.profile.isAvailable ? 'Available' : 'Offline'"/>
          <Switch checked="state.profile.isAvailable" onChange="toggleAvailability" label="'Available for tasks'"/>
        </label>
      </t>

      <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
      <div t-elif="!state.profile" class="flex flex-col gap-4" aria-busy="true">
        <div class="skeleton h-4 w-44 rounded-md"/>
        <div class="grid gap-3 md:grid-cols-2">
          <TaskCardSkeleton/>
          <TaskCardSkeleton/>
        </div>
      </div>
      <div t-else="" class="flex flex-col gap-4">
        <p class="text-sm text-ink-500">
          Within <t t-out="radius"/> km of <t t-out="state.profile.baseCity"/>
        </p>

        <div t-if="needsVerification" class="flex items-start gap-2 rounded-card border border-progress bg-tint-orange p-3 text-sm text-ink-700" role="status">
          <Icon name="'shield-alert'" size="16" class="'mt-0.5 shrink-0 text-progress'"/>
          <span>
            Verify your email to accept tasks — every task requires at least verification level 1, so
            none will appear here until you do.
            <Link to="'/dashboard'" class="linkClass">Verify now</Link>
          </span>
        </div>

        <p t-if="state.actionError" role="alert" class="text-sm text-dispute" t-out="state.actionError"/>

        <EmptyState t-if="!state.profile.isAvailable"
          title="'You’re offline'" description="'Turn availability on to see and accept nearby tasks.'"/>
        <div t-elif="!state.tasks" class="grid gap-3 md:grid-cols-2">
          <TaskCardSkeleton/>
          <TaskCardSkeleton/>
          <TaskCardSkeleton/>
        </div>
        <EmptyState t-elif="state.tasks.length === 0"
          title="'Nothing nearby right now'" description="'New tasks in your categories will show up here.'"/>
        <div t-else="" class="grid gap-3 md:grid-cols-2">
          <TaskCard t-foreach="state.tasks" t-as="task" t-key="task.id"
            task="task" onAccept="accept" accepting="state.acceptingId === task.id"/>
        </div>
      </div>
    </Page>`;
  static components = { EmptyState, Icon, Link, Page, Switch, TaskCard, TaskCardSkeleton };
  static override props = {};

  store = useState(store);
  state = useState<FeedState>({
    profile: null,
    tasks: null,
    error: null,
    acceptingId: null,
    actionError: null,
  });

  linkClass = LINK;

  private disposed = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  override setup() {
    onMounted(() => {
      void this.init();
    });
    onWillUnmount(() => {
      this.disposed = true;
      if (this.pollTimer) clearInterval(this.pollTimer);
    });
  }

  get radius(): string {
    return this.state.profile ? radiusKm(this.state.profile.workingRadiusMeters) : '';
  }

  get needsVerification(): boolean {
    const user = this.store.user;
    return user !== null && user.verificationLevel < 1;
  }

  private async init() {
    try {
      const profile = await api.get<WorkerProfile>('/workers/me');
      if (this.disposed) return;
      this.state.profile = profile;
      // The feed has no push channel for "a task was just published nearby"
      // (ai/memory.md: a real gap, not fixed here). A plain poll while the tab
      // is visible is the honest stopgap: new work shows within ~20s.
      this.pollTimer = setInterval(() => {
        const current = this.state.profile;
        if (document.visibilityState === 'visible' && current) void this.loadFeed(current).catch(() => undefined);
      }, POLL_MS);
      await this.loadFeed(profile);
    } catch (err) {
      if (this.disposed) return;
      if (err instanceof ApiError && err.status === 404) {
        navigate('/worker/onboarding', { replace: true });
        return;
      }
      this.state.error = 'Could not load your worker profile.';
    }
  }

  private async loadFeed(profile: WorkerProfile) {
    const [{ data: categories }, { data: items }] = await Promise.all([
      api.get<{ data: CategoryView[] }>('/categories'),
      api.get<{ data: RawFeedItem[] }>(
        `/tasks/nearby?latitude=${profile.baseLocation.latitude}&longitude=${profile.baseLocation.longitude}` +
          `&radiusMeters=${profile.workingRadiusMeters}&limit=20`,
      ),
    ]);
    if (this.disposed) return;
    const iconBySlug = new Map<string, string>(categories.map((c) => [c.slug, c.icon]));
    this.state.tasks = items.map((t) => ({ ...t, categoryIcon: iconBySlug.get(t.categorySlug) ?? '' }));
  }

  toggleAvailability = async (isAvailable: boolean) => {
    const previous = this.state.profile;
    if (!previous) return;
    this.state.profile = { ...previous, isAvailable };
    try {
      await api.patch('/workers/me/availability', { isAvailable });
    } catch {
      this.state.profile = previous;
    }
  };

  accept = async (taskId: string) => {
    this.state.acceptingId = taskId;
    this.state.actionError = null;
    try {
      await api.post(`/tasks/${taskId}/accept`);
      toast('Task accepted', { description: 'Head to the task to get started.', variant: 'success' });
      navigate(`/tasks/${taskId}`);
    } catch (err) {
      this.state.actionError =
        err instanceof ApiError ? err.message : 'Could not accept this task. It may have just been taken.';
      const profile = this.state.profile;
      if (profile) await this.loadFeed(profile).catch(() => undefined);
    } finally {
      this.state.acceptingId = null;
    }
  };
}
