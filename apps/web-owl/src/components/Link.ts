import { Component, xml } from '@odoo/owl';
import { navigate } from '@/router/router';

/** Client-side navigation link. Modified clicks (new tab, etc.) fall through to the browser. */
export class Link extends Component {
  static override template = xml`
    <a t-att-href="props.to" t-att-class="props.class" t-att-aria-label="props.ariaLabel" t-att-aria-current="props.current ? 'page' : undefined" t-on-click="onClick"><t t-slot="default"/></a>`;
  static override props = {
    to: String,
    class: { type: String, optional: true },
    ariaLabel: { type: String, optional: true },
    /** Marks the link as the current page for assistive technology. */
    current: { type: Boolean, optional: true },
    slots: { type: Object, optional: true },
  };

  onClick(ev: MouseEvent) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    navigate(this.props.to);
  }
}
