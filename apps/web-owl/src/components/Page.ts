import { Component, xml } from '@odoo/owl';
import { Link } from './Link';

export interface Crumb {
  label: string;
  /** Present on every crumb except the current page. */
  to?: string;
}

/**
 * The page header every screen renders inside: small breadcrumbs back to the
 * parent screens, the current page as a large title, and actions on the
 * right. The `actions` slot holds the buttons; the default slot is the view
 * body. A screen with its own <h1> passes `heading="false"` so the title is
 * not repeated.
 */
export class Page extends Component {
  static override template = xml`
    <div class="page-enter">
      <div class="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-3 px-4 pt-5 sm:pt-7">
        <div t-if="parents.length or showHeading" class="min-w-0">
          <nav t-if="parents.length" aria-label="Breadcrumb">
            <ol class="flex flex-wrap items-center gap-1 text-sm">
              <li t-foreach="parents" t-as="crumb" t-key="crumb_index" class="flex items-center gap-1">
                <Link to="crumb.to" class="'font-medium text-ink-500 hover:text-ink-900'"><t t-out="crumb.label"/></Link>
                <span class="text-ink-300" aria-hidden="true">›</span>
              </li>
              <li t-if="!showHeading"><span class="font-medium text-ink-900" aria-current="page" t-out="current"/></li>
            </ol>
          </nav>
          <h1 t-if="showHeading" class="mt-0.5 truncate text-2xl font-bold tracking-tight text-ink-900 sm:text-[28px]" t-out="current"/>
        </div>
        <div class="flex items-center gap-2"><t t-slot="actions"/></div>
      </div>
      <div class="mx-auto max-w-6xl px-4 pb-tabbar pt-4 sm:pt-5"><t t-slot="default"/></div>
    </div>`;
  static components = { Link };
  static override props = {
    breadcrumbs: Array,
    /** False when the screen renders its own <h1>. Defaults to true. */
    heading: { type: Boolean, optional: true },
    slots: { type: Object, optional: true },
  };

  get crumbs(): Crumb[] {
    return this.props.breadcrumbs as Crumb[];
  }

  get parents(): Crumb[] {
    return this.crumbs.filter((crumb) => crumb.to);
  }

  get current(): string {
    return this.crumbs.at(-1)?.label ?? '';
  }

  get showHeading(): boolean {
    return this.props.heading !== false;
  }
}
