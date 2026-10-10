import { Component, useEffect, useState, xml } from '@odoo/owl';
import { navigate, routeByName, routerState, type Layout, type RouteDef } from '@/router/router';
import { store } from '@/store/store';
import { NoAccessView, NotFoundView } from '@/views/NotFoundView';
import { AuthLayout } from './AuthLayout';
import { InstallBanner } from './InstallBanner';
import { Shell } from './Shell';
import { Spinner } from './Spinner';
import { Toaster } from './Toaster';

/**
 * Root component: picks the layout and view for the current route and applies
 * route guards. As in apps/web, guarding is client-side only; the API's guards
 * are the real gate.
 */
export class App extends Component {
  static override template = xml`
    <div>
      <InstallBanner/>
      <t t-if="showSpinner">
        <div class="flex min-h-screen items-center justify-center bg-paper-50"><Spinner/></div>
      </t>
      <t t-elif="layout === 'app'">
        <Shell><t t-component="view" t-key="router.path"/></Shell>
      </t>
      <t t-elif="layout === 'auth'">
        <AuthLayout><t t-component="view" t-key="router.path"/></AuthLayout>
      </t>
      <t t-else="">
        <t t-component="view" t-key="router.path"/>
      </t>
      <Toaster/>
    </div>`;
  static components = { AuthLayout, InstallBanner, Shell, Spinner, Toaster };
  static override props = {};

  store = useState(store);
  router = useState(routerState);

  override setup() {
    useEffect(
      () => {
        if (this.needsUser && !this.store.isLoading && !this.store.user) {
          navigate('/sign-in', { replace: true });
        }
      },
      () => [this.needsUser, this.store.isLoading, this.store.user],
    );
  }

  get route(): RouteDef | null {
    return routeByName(this.router.routeName);
  }

  get layout(): Layout {
    return this.route?.layout ?? 'marketing';
  }

  get needsUser(): boolean {
    const route = this.route;
    return route !== null && route.guard !== 'public';
  }

  get showSpinner(): boolean {
    return this.needsUser && (this.store.isLoading || !this.store.user);
  }

  get view(): typeof Component {
    const route = this.route;
    if (!route) return NotFoundView;
    if (route.guard === 'admin' && this.store.user?.platformRole !== 'ADMIN') return NoAccessView;
    return route.component;
  }
}
