import { Component, onMounted, onWillUnmount, useRef, useState, xml } from '@odoo/owl';
import { navigate, routerState } from '@/router/router';
import { logout } from '@/services/session';
import { startSessionSocket, stopSessionSocket } from '@/services/socket';
import { store } from '@/store/store';
import { btn, MENU_ITEM } from '@/ui/classes';
import { Dropdown } from './Dropdown';
import { IncomingRequest } from './IncomingRequest';
import { Icon } from './Icon';
import { Link } from './Link';
import { Logo } from './Logo';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const POST_TASK = '/tasks/new';

/**
 * The signed-in app chrome, in the style of Indian consumer apps: a white
 * sticky header with the logo, section pills (desktop), notifications and an
 * account menu; and on phones a bottom tab bar with a raised "Post" button,
 * since that is where a thumb is. Each screen supplies its own header via
 * <Page>.
 */
export class Shell extends Component {
  static override template = xml`
    <div data-surface="app" class="min-h-screen bg-paper-50">
      <header class="sticky top-0 z-30 border-b border-line-light bg-white/90 backdrop-blur">
        <div class="mx-auto flex h-[var(--navbar-height)] max-w-6xl items-center gap-2 px-4">
          <Link to="'/dashboard'" class="'mr-2 flex items-center rounded-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900'" ariaLabel="'OnSite home'">
            <Logo/>
          </Link>

          <nav class="hidden items-center gap-1 md:flex" aria-label="Main">
            <Link t-foreach="navItems" t-as="item" t-key="item.href" to="item.href" class="navLinkClass(item.href)" current="isActive(item.href)">
              <t t-out="item.label"/>
            </Link>
          </nav>

          <div class="ml-auto flex items-center gap-1">
            <Link to="postTask" class="postClass">
              <Icon name="'plus'" size="16"/> Post a task
            </Link>
            <NotificationBell/>
            <Dropdown toggleClass="accountButtonClass" label="'Account menu'" align="'right'">
              <t t-set-slot="toggle">
                <span class="flex h-8 w-8 items-center justify-center rounded-full bg-brand-solid text-sm font-bold text-ink-900" t-out="initial"/>
                <span class="hidden max-w-[10rem] truncate text-sm font-medium lg:inline" t-out="displayName"/>
              </t>
              <div class="px-3 pb-2 pt-1.5">
                <p class="truncate text-sm font-semibold text-ink-900" t-out="displayName"/>
                <p t-if="email" class="truncate text-xs text-ink-500" t-out="email"/>
              </div>
              <div class="my-1 border-t border-line-light"/>
              <div class="md:hidden">
                <Link t-foreach="menuOnlyItems" t-as="item" t-key="item.href" to="item.href" class="menuItemClass">
                  <t t-out="item.label"/>
                </Link>
              </div>
              <Link to="'/settings'" class="menuItemClass">Settings</Link>
              <Link to="'/kyc'" class="menuItemClass">Identity verification</Link>
              <div class="my-1 border-t border-line-light"/>
              <button type="button" role="menuitem" t-att-class="signOutClass" t-on-click="openDialog">Sign out</button>
            </Dropdown>
          </div>
        </div>
      </header>

      <main><t t-slot="default"/></main>

      <!-- Live events for the signed-in user: incoming task requests (workers), "your task was accepted" (requesters). -->
      <IncomingRequest/>

      <nav t-if="showTabBar" class="fixed inset-x-0 bottom-0 z-30 border-t border-line-light bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Tabs">
        <div class="mx-auto grid h-[var(--tabbar-height)] max-w-md grid-cols-5 items-center px-2">
          <t t-foreach="tabs" t-as="tab" t-key="tab.href">
            <Link t-if="tab.href === postTask" to="tab.href" class="'flex flex-col items-center gap-0.5 text-[11px] font-semibold text-ink-900'" current="isActive(tab.href)">
              <span class="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-solid shadow-float ring-4 ring-paper-0 transition-transform duration-micro ease-onsite active:scale-95">
                <Icon name="'plus'" size="26"/>
              </span>
              <t t-out="tab.label"/>
            </Link>
            <Link t-else="" to="tab.href" class="tabClass(tab.href)" current="isActive(tab.href)">
              <span t-att-class="tabIconClass(tab.href)"><Icon name="tab.icon" size="22"/></span>
              <t t-out="tab.label"/>
            </Link>
          </t>
        </div>
      </nav>

      <dialog t-ref="dialog" class="w-[calc(100%-2rem)] max-w-md rounded-sheet border border-line bg-paper-0 p-6 shadow-float backdrop:bg-black/40">
        <h2 class="text-lg font-semibold text-ink-900">Sign out?</h2>
        <p class="mt-1 text-sm text-ink-500">You’ll need to sign in again to access your account.</p>
        <div class="mt-6 flex justify-end gap-3">
          <button type="button" t-att-class="cancelClass" t-on-click="closeDialog">Cancel</button>
          <button type="button" t-att-class="confirmClass" t-on-click="confirmLogout">Sign out</button>
        </div>
      </dialog>
    </div>`;
  static components = { Dropdown, Icon, IncomingRequest, Link, Logo, NotificationBell };
  static override props = { slots: { type: Object, optional: true } };

  store = useState(store);
  router = useState(routerState);
  dialog = useRef('dialog');
  postTask = POST_TASK;

  override setup() {
    onMounted(() => startSessionSocket());
    onWillUnmount(() => stopSessionSocket());
  }

  accountButtonClass =
    'flex min-h-[40px] items-center gap-2 rounded-full p-1 pr-1 text-ink-900 transition-colors duration-micro ease-onsite ' +
    'hover:bg-paper-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 lg:pr-3';
  postClass = btn('primary', 'sm', 'mr-1 hidden md:inline-flex');
  menuItemClass = MENU_ITEM;
  signOutClass = `${MENU_ITEM} text-dispute`;
  cancelClass = btn('secondary');
  confirmClass = btn('destructive');

  get displayName(): string {
    return this.store.user?.displayName ?? '';
  }

  get email(): string {
    return this.store.user?.email ?? '';
  }

  get initial(): string {
    return this.displayName.trim().charAt(0).toUpperCase();
  }

  get isWorker(): boolean {
    return Boolean(this.store.user?.hasWorkerProfile);
  }

  /** The desktop header sections. */
  get navItems(): NavItem[] {
    const user = this.store.user;
    const items: NavItem[] = [
      { href: '/dashboard', label: 'Home', icon: 'home' },
      { href: '/tasks', label: 'My tasks', icon: 'list-checks' },
    ];
    if (this.isWorker) {
      items.push({ href: '/feed', label: 'Feed', icon: 'radar' }, { href: '/worker/earnings', label: 'Earnings', icon: 'indian-rupee' });
    }
    items.push({ href: '/payments', label: 'Payments', icon: 'wallet' });
    if (user?.platformRole === 'ADMIN') items.push({ href: '/admin', label: 'Admin', icon: 'shield-check' });
    return items;
  }

  /** The phone tab bar: five slots, the middle one always "Post". */
  get tabs(): NavItem[] {
    const post = { href: POST_TASK, label: 'Post', icon: 'plus' };
    const home = { href: '/dashboard', label: 'Home', icon: 'home' };
    const tasks = { href: '/tasks', label: 'My tasks', icon: 'list-checks' };
    if (this.isWorker) {
      return [home, tasks, post, { href: '/feed', label: 'Feed', icon: 'radar' }, { href: '/worker/earnings', label: 'Earnings', icon: 'indian-rupee' }];
    }
    return [home, tasks, post, { href: '/payments', label: 'Payments', icon: 'wallet' }, { href: '/settings', label: 'Account', icon: 'user' }];
  }

  /** Hidden inside the post-a-task flow, which has its own bottom action bar. */
  get showTabBar(): boolean {
    return this.router.path !== POST_TASK;
  }

  /** Sections that do not fit in the phone tab bar, listed in the account menu instead. */
  get menuOnlyItems(): NavItem[] {
    const inTabs = new Set(this.tabs.map((tab) => tab.href));
    return this.navItems.filter((item) => !inTabs.has(item.href));
  }

  isActive(href: string): boolean {
    const path = this.router.path;
    if (href === '/tasks') return path === '/tasks' || (path.startsWith('/tasks/') && path !== POST_TASK);
    return path === href || path.startsWith(`${href}/`);
  }

  navLinkClass(href: string): string {
    const base = 'rounded-full px-4 py-2 text-sm transition-colors duration-micro ease-onsite';
    return this.isActive(href)
      ? `${base} bg-ink-900 font-semibold text-white`
      : `${base} font-medium text-ink-500 hover:bg-paper-100 hover:text-ink-900`;
  }

  tabClass(href: string): string {
    const base = 'flex flex-col items-center gap-0.5 text-[11px] transition-colors duration-micro ease-onsite';
    return this.isActive(href) ? `${base} font-semibold text-ink-900` : `${base} font-medium text-ink-400`;
  }

  tabIconClass(href: string): string {
    const base = 'flex h-8 w-12 items-center justify-center rounded-full transition-colors duration-base ease-onsite';
    return this.isActive(href) ? `${base} bg-brand-solid` : base;
  }

  openDialog() {
    (this.dialog.el as HTMLDialogElement | null)?.showModal();
  }

  closeDialog() {
    (this.dialog.el as HTMLDialogElement | null)?.close();
  }

  async confirmLogout() {
    await logout();
    this.closeDialog();
    navigate('/sign-in');
  }
}
