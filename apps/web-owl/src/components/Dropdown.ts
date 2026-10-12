import { Component, useExternalListener, useRef, useState, xml } from '@odoo/owl';

/**
 * A toggle button with a menu. The `toggle` slot is the button's content; the
 * default slot is the menu. Closes on outside click, Escape, or any click
 * inside the menu (so a menu item that navigates also dismisses it).
 */
export class Dropdown extends Component {
  static override template = xml`
    <div class="relative" t-ref="root">
      <button
        type="button"
        t-att-class="props.toggleClass"
        aria-haspopup="menu"
        t-att-aria-expanded="state.open ? 'true' : 'false'"
        t-att-aria-label="props.label"
        t-on-click="toggle"
      >
        <t t-slot="toggle"/>
      </button>
      <div t-if="state.open" role="menu" t-att-class="menuClass" t-on-click="close">
        <t t-slot="default"/>
      </div>
    </div>`;
  static override props = {
    toggleClass: { type: String, optional: true },
    label: { type: String, optional: true },
    align: { type: String, optional: true },
    slots: { type: Object, optional: true },
  };

  state = useState({ open: false });
  root = useRef('root');

  override setup() {
    useExternalListener(window, 'click', (ev: Event) => {
      const el = this.root.el;
      if (this.state.open && el && !el.contains(ev.target as Node)) this.close();
    });
    useExternalListener(window, 'keydown', (ev: Event) => {
      if ((ev as KeyboardEvent).key === 'Escape') this.close();
    });
  }

  get menuClass(): string {
    const side = this.props.align === 'right' ? 'right-0' : 'left-0';
    return `absolute ${side} top-full z-40 mt-2 min-w-[220px] rounded-card border border-line-light bg-paper-0 p-1.5 shadow-float`;
  }

  toggle() {
    this.state.open = !this.state.open;
  }

  close() {
    this.state.open = false;
  }
}
