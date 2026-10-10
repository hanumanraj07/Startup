import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { api } from '@/services/api';
import { countUnread, type NotificationItem } from '@/services/notifications';
import { store, toast } from '@/store/store';
import { btn, card } from '@/ui/classes';

const BAR = 'animate-pulse rounded bg-paper-100';

/** The notification list. Unread items get a brand-coloured left edge; "Mark all read" clears them in one call. */
export class NotificationsView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Notifications' }]">
      <t t-set-slot="actions">
        <button t-if="unread > 0" type="button" t-att-class="markClass" t-att-disabled="state.busy" t-on-click="markAllRead">Mark all read</button>
      </t>

      <div class="mx-auto flex max-w-2xl flex-col gap-2">
        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>

        <div t-if="!state.items" class="flex flex-col gap-2" aria-hidden="true">
          <div t-foreach="[0, 1, 2]" t-as="i" t-key="i" t-att-class="skeletonClass">
            <div class="h-4 w-1/3 ${BAR}"/><div class="h-3 w-2/3 ${BAR}"/>
          </div>
        </div>
        <EmptyState t-elif="state.items.length === 0" icon="'bell'" title="'Nothing yet'" description="'Updates on your tasks will show up here.'"/>
        <div t-else="" class="flex flex-col gap-2">
          <div t-foreach="state.items" t-as="n" t-key="n.id" t-att-class="itemClass(n)">
            <div class="flex items-center justify-between gap-4">
              <span class="font-medium text-ink-900" t-out="n.title"/>
              <span class="whitespace-nowrap text-xs text-ink-400" t-out="when(n)"/>
            </div>
            <p class="text-sm text-ink-500" t-out="n.body"/>
          </div>
        </div>
      </div>
    </Page>`;
  static components = { EmptyState, Page };
  static override props = {};

  state = useState<{ items: NotificationItem[] | null; error: string | null; busy: boolean }>({
    items: null,
    error: null,
    busy: false,
  });
  markClass = btn('secondary', 'sm');
  skeletonClass = card('flex flex-col gap-2 px-4 py-4');

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  get unread(): number {
    return this.state.items ? countUnread(this.state.items) : 0;
  }

  itemClass(n: NotificationItem): string {
    return card(`flex flex-col gap-1 px-4 py-4 ${n.readAt ? '' : 'border-l-4 border-l-brand-600'}`);
  }

  when(n: NotificationItem): string {
    return new Date(n.createdAt).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private async load() {
    try {
      const res = await api.get<{ data: NotificationItem[] }>('/notifications?limit=50');
      if (this.disposed) return;
      this.state.items = res.data;
      this.state.error = null;
      store.unreadNotifications = countUnread(res.data);
    } catch {
      if (!this.disposed) this.state.error = 'Could not load notifications.';
    }
  }

  markAllRead = async () => {
    this.state.busy = true;
    try {
      await api.post('/notifications/read', {});
      await this.load();
      toast('All notifications marked read', { variant: 'success' });
    } catch {
      toast('Could not mark notifications read', { variant: 'error' });
    } finally {
      this.state.busy = false;
    }
  };
}
