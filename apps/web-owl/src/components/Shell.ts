import { Component, useRef, useState, xml } from '@odoo/owl';
import { navigate, routerState } from '@/router/router';
import { logout } from '@/services/session';
import { store } from '@/store/store';
import { btn } from '@/ui/classes';
import { Link } from './Link';

interface NavItem {
  href: string;
  label: string;
}

/**
 * The signed-in app chrome (apps/web's `(app)/layout.tsx`). The notification
 * bell and mobile bottom nav are ported with their screens, not here.
 */
export class Shell extends Component {
  static override template = xml`
    <div data-surface="app" class="min-h-screen bg-paper-50">
      <header class="border-b border-line bg-paper-0">
        <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div class="flex items-center gap-6">
            <Link to="'/dashboard'" class="'text-lg font-bold tracking-tight text-ink-900'">OnSite</Link>
            <nav class="hidden items-center gap-4 sm:flex">
              <Link t-foreach="navItems" t-as="item" t-key="item.href" to="item.href" class="navClass(item.href)">
                <t t-out="item.label"/>
              </Link>
            </nav>
          </div>
          <div class="flex items-center gap-4">
            <span class="text-sm text-ink-500" t-out="displayName"/>
            <button type="button" t-att-class="signOutClass" t-on-click="openDialog">Sign out</button>
          </div>
        </div>
      </header>
      <main class="mx-auto max-w-6xl px-4 py-8 pb-24 sm:pb-8"><t t-slot="default"/></main>

      <dialog t-ref="dialog" class="w-full max-w-md rounded-card border border-line bg-paper-0 p-6 shadow-elevated backdrop:bg-ink-900/40">
        <h2 class="text-[19px] font-semibold text-ink-900">Sign out?</h2>
        <p class="mt-1 text-sm text-ink-500">You’ll need to sign in again to access your account.</p>
        <div class="mt-6 flex justify-end gap-3">
          <button type="button" t-att-class="cancelClass" t-on-click="closeDialog">Cancel</button>
          <button type="button" t-att-class="confirmClass" t-on-click="confirmLogout">Sign out</button>
        </div>
      </dialog>
    </div>`;
  static components = { Link };
  static override props = { slots: { type: Object, optional: true } };

  store = useState(store);
  router = useState(routerState);
  dialog = useRef('dialog');

  signOutClass = btn('ghost', 'sm');
  cancelClass = btn('secondary');
  confirmClass = btn('destructive');

  get displayName(): string {
    return this.store.user?.displayName ?? '';
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

  navClass(href: string): string {
    const path = this.router.path;
    const active = path === href || path.startsWith(`${href}/`);
    return `text-sm font-medium transition-colors duration-micro ease-onsite ${
      active ? 'text-brand-600' : 'text-ink-500 hover:text-ink-900'
    }`;
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
