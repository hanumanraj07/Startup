import { Component, useState, xml } from '@odoo/owl';
import { routeByName, routerState } from '@/router/router';
import { card, CARD_CONTENT, CARD_DESCRIPTION, CARD_HEADER, CARD_TITLE } from '@/ui/classes';

/** Stand-in for a screen that has not been ported from apps/web yet. */
export class PlaceholderView extends Component {
  static override template = xml`
    <div t-att-class="cardClass">
      <div class="${CARD_HEADER}">
        <h1 class="${CARD_TITLE}" t-out="title"/>
        <p class="${CARD_DESCRIPTION}">Not ported from apps/web yet.</p>
      </div>
      <div class="${CARD_CONTENT} text-sm text-ink-500">
        <p>Route: <code t-out="router.path"/></p>
        <p t-if="hasParams">Params: <code t-out="paramsText"/></p>
      </div>
    </div>`;
  static override props = {};

  router = useState(routerState);
  cardClass = card();

  get title(): string {
    return routeByName(this.router.routeName)?.title ?? '';
  }

  get hasParams(): boolean {
    return Object.keys(this.router.params).length > 0;
  }

  get paramsText(): string {
    return JSON.stringify(this.router.params);
  }
}
