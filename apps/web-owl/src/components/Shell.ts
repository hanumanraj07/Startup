import { Component, useRef, useState, xml } from '@odoo/owl';
import { navigate, routerState } from '@/router/router';
import { logout } from '@/services/session';
import { store } from '@/store/store';
import { btn, MENU_ITEM } from '@/ui/classes';
import { Dropdown } from './Dropdown';
import { Link } from './Link';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  href: string;
  label: string;
}

/**
 * The signed-in app chrome, styled after the Odoo web client: a purple
 * navbar with an apps menu (which also serves as the phone navigation), the
 * current section links, and a user menu. Each screen supplies its own
 * control panel via <Page>.
 */
export class Shell extends Component {
  static override template = xml`
    <div data-surface="app" class="min-h-screen bg-paper-50">
      <header class="bg-brand-solid text-white shadow-card">
        <div class="mx-auto flex h-[var(--navbar-height)] max-w-none items-center gap-1 px-2 sm:px-3">
          <Dropdown toggleClass="navButtonClass" label="'Apps menu'">
            <t t-set-slot="toggle">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <circle cx="3" cy="3" r="1.6"/><circle cx="8" cy="3" r="1.6"/><circle cx="13" cy="3" r="1.6"/>
                <circle cx="3" cy="8" r="1.6"/><circle cx="8" cy="8" r="1.6"/><circle cx="13" cy="8" r="1.6"/>
                <circle cx="3" cy="13" r="1.6"/><circle cx="8" cy="13" r="1.6"/><circle cx="13" cy="13" r="1.6"/>
              </svg>
            </t>
            <Link t-foreach="navItems" t-as="item" t-key="item.href" to="item.href" class="menuItemClass">
              <t t-out="item.label"/>
            </Link>
          </Dropdown>

          <Link to="'/dashboard'" class="'px-2 text-[17px] font-semibold tracking-tight text-white'">OnSite</Link>

          <nav class="hidden items-center gap-0.5 sm:flex" aria-label="Main">
            <Link t-foreach="navItems" t-as="item" t-key="item.href" to="item.href" class="navLinkClass(item.href)">
              <t t-out="item.label"/>
            </Link>
          </nav>

          <div class="ml-auto flex items-center gap-1">
            <NotificationBell/>
            <Dropdown toggleClass="navButtonClass" label="'User menu'" align="'right'">
              <t t-set-slot="toggle">
                <span class="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-xs font-semibold" t-out="initial"/>
                <span class="hidden text-sm sm:inline" t-out="displayName"/>
              </t>
              <Link to="'/settings'" class="menuItemClass">Settings</Link>
              <Link to="'/kyc'" class="menuItemClass">Identity verification</Link>
              <button type="button" role="menuitem" t-att-class="menuItemClass" t-on-click="openDialog">Sign out</button>
            </Dropdown>
          </div>
        </div>
      </header>

      <main><t t-slot="default"/></main>

      <dialog t-ref="dialog" class="w-full max-w-md rounded-card border border-line bg-paper-0 p-6 shadow-float backdrop:bg-ink-900/40">
        <h2 class="text-lg font-medium text-ink-900">Sign out?</h2>
        <p class="mt-1 text-sm text-ink-500">You’ll need to sign in again to access your account.</p>
        <div class="mt-6 flex justify-end gap-3">
          <button type="button" t-att-class="cancelClass" t-on-click="closeDialog">Cancel</button>
          <button type="button" t-att-class="confirmClass" t-on-click="confirmLogout">Sign out</button>
        </div>
      </dialog>
    </div>`;
  static components = { Dropdown, Link, NotificationBell };
  static override props = { slots: { type: Object, optional: true } };

  store = useState(store);
  router = useState(routerState);
  dialog = useRef('dialog');

  navButtonClass =
    'flex min-h-[32px] items-center gap-2 rounded-input px-2.5 text-white/90 transition-colors duration-micro ease-onsite ' +
    'hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60';
  menuItemClass = MENU_ITEM;
  cancelClass = btn('secondary');
  confirmClass = btn('destructive');

  get displayName(): string {
    return this.store.user?.displayName ?? '';
  }

  get initial(): string {
    return this.displayName.trim().charAt(0).toUpperCase();
  }

  get navItems(): NavItem[] {
    const user = this.store.user;
    const items: NavItem[] = [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/tasks', label: 'My tasks' },
      { href: '/payments', label: 'Payments' },
    ];
    if (user?.hasWorkerProfile) {
      items.push({ href: '/feed', label: 'Feed' }, { href: '/worker/earnings', label: 'Earnings' });
    }
    if (user?.platformRole === 'ADMIN') items.push({ href: '/admin/kyc', label: 'Admin' });
    items.push({ href: '/settings', label: 'Settings' });
    return items;
  }

  navLinkClass(href: string): string {
    const path = this.router.path;
    const active = path === href || path.startsWith(`${href}/`);
    const base = 'rounded-input px-3 py-1.5 text-sm transition-colors duration-micro ease-onsite hover:bg-white/10 hover:text-white';
    return active ? `${base} bg-white/15 font-medium text-white` : `${base} text-white/80`;
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
