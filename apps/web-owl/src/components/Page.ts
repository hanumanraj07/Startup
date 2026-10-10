import { Component, xml } from '@odoo/owl';
import { Link } from './Link';

export interface Crumb {
  label: string;
  /** Present on every crumb except the current page. */
  to?: string;
}

/**
 * Odoo-style "control panel" (breadcrumbs on the left, actions on the right)
 * above a content area. Every screen renders inside one. The `actions` slot
 * holds the buttons; the default slot is the view body.
 */
export class Page extends Component {
  static override template = xml`
    <div>
      <div class="border-b border-line bg-paper-0">
        <div class="mx-auto flex min-h-[52px] max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2">
          <nav aria-label="Breadcrumb">
            <ol class="flex flex-wrap items-center gap-1.5 text-[17px]">
              <li t-foreach="props.breadcrumbs" t-as="crumb" t-key="crumb_index" class="flex items-center gap-1.5">
                <span t-if="crumb_index !== 0" class="text-ink-400" aria-hidden="true">/</span>
                <Link t-if="crumb.to" to="crumb.to" class="'text-accent-600 hover:underline'"><t t-out="crumb.label"/></Link>
                <span t-else="" class="font-medium text-ink-900" aria-current="page" t-out="crumb.label"/>
              </li>
            </ol>
          </nav>
          <div class="flex items-center gap-2"><t t-slot="actions"/></div>
        </div>
      </div>
      <div class="mx-auto max-w-6xl px-4 py-4"><t t-slot="default"/></div>
    </div>`;
  static components = { Link };
  static override props = {
    breadcrumbs: Array,
    slots: { type: Object, optional: true },
  };
}
