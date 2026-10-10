import { Component, useState, xml } from '@odoo/owl';
import { Page, type Crumb } from '@/components/Page';
import { routeByName, routerState } from '@/router/router';
import { card } from '@/ui/classes';

/** Stand-in for a screen that has not been ported from apps/web yet. */
export class PlaceholderView extends Component {
  static override template = xml`
    <Page breadcrumbs="breadcrumbs">
      <div t-att-class="cardClass">
        <p class="text-sm text-ink-500">Not ported from apps/web yet.</p>
        <p class="mt-3 text-sm text-ink-500">Route: <code t-out="router.path"/></p>
        <p t-if="hasParams" class="text-sm text-ink-500">Params: <code t-out="paramsText"/></p>
      </div>
    </Page>`;
  static components = { Page };
  static override props = {};

  router = useState(routerState);
  cardClass = card('p-6');

  get breadcrumbs(): Crumb[] {
    return [{ label: routeByName(this.router.routeName)?.title ?? '' }];
  }

  get hasParams(): boolean {
    return Object.keys(this.router.params).length > 0;
  }

  get paramsText(): string {
    return JSON.stringify(this.router.params);
  }
}
