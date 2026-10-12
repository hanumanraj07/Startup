import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { refreshUnread } from '@/services/notifications';
import { store } from '@/store/store';
import { Icon } from './Icon';
import { Link } from './Link';

const POLL_MS = 30_000;

/** Header bell with an unread badge. Polls on a 30s compromise, and only while the tab is visible. */
export class NotificationBell extends Component {
  static override template = xml`
    <Link to="'/notifications'" class="linkClass" ariaLabel="label">
      <Icon name="'bell'" size="20"/>
      <span t-if="store.unreadNotifications > 0"
        class="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-dispute px-1 text-[10px] font-semibold text-white"
        t-out="badge"/>
    </Link>`;
  static components = { Icon, Link };
  static override props = {};

  store = useState(store);
  linkClass =
    'relative flex h-10 w-10 items-center justify-center rounded-full text-ink-700 ' +
    'transition-colors duration-micro ease-onsite hover:bg-paper-100 hover:text-ink-900';

  private timer: ReturnType<typeof setInterval> | null = null;

  override setup() {
    onMounted(() => {
      void refreshUnread();
      this.timer = setInterval(() => {
        if (document.visibilityState === 'visible') void refreshUnread();
      }, POLL_MS);
    });
    onWillUnmount(() => {
      if (this.timer) clearInterval(this.timer);
    });
  }

  get badge(): string {
    const n = this.store.unreadNotifications;
    return n > 9 ? '9+' : String(n);
  }

  get label(): string {
    const n = this.store.unreadNotifications;
    return n > 0 ? `Notifications, ${n} unread` : 'Notifications';
  }
}
