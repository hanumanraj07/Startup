import { Component, useState, xml } from '@odoo/owl';
import { routerState } from '@/router/router';
import { Link } from '../Link';
import { Page, type Crumb } from '../Page';

const TABS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/kyc', label: 'KYC queue' },
  { href: '/admin/disputes', label: 'Disputes' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/tasks', label: 'Tasks' },
  { href: '/admin/categories', label: 'Categories & cities' },
];

/**
 * The admin console frame: the standard control panel, then a tab bar across
 * the admin sections. The real gate is the API's AdminGuard on every /admin/*
 * route; the router's admin guard only stops a non-admin seeing a console of 403s.
 * Functional-first: no decoration (docs/19-ui-design-system.md).
 */
export class AdminPage extends Component {
  static override template = xml`
    <Page breadcrumbs="crumbs">
      <t t-set-slot="actions"><t t-slot="actions"/></t>
      <nav class="mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Admin sections">
        <Link t-foreach="tabs" t-as="tab" t-key="tab.href" to="tab.href" class="tabClass(tab.href)">
          <t t-out="tab.label"/>
        </Link>
      </nav>
      <t t-slot="default"/>
    </Page>`;
  static components = { Link, Page };
  static override props = {
    /** Crumbs after "Admin". Leave empty on the admin dashboard itself. */
    breadcrumbs: { type: Array, optional: true },
    slots: { type: Object, optional: true },
  };

  router = useState(routerState);
  tabs = TABS;

  get crumbs(): Crumb[] {
    const rest = (this.props.breadcrumbs ?? []) as Crumb[];
    return rest.length === 0 ? [{ label: 'Admin' }] : [{ label: 'Admin', to: '/admin' }, ...rest];
  }

  tabClass(href: string): string {
    const path = this.router.path;
    // '/admin' would prefix-match every admin route, so the dashboard tab is exact; the rest are subtrees.
    const active = href === '/admin' ? path === '/admin' : path === href || path.startsWith(`${href}/`);
    const base = 'whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors duration-micro ease-onsite';
    return active ? `${base} border-ink-900 font-semibold text-ink-900` : `${base} border-transparent text-ink-500 hover:text-ink-900`;
  }
}
