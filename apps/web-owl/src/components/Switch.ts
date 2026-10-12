import { Component, xml } from '@odoo/owl';

/** An on/off toggle (`role="switch"`). Controlled: the parent owns `checked` and updates it from `onChange`. */
export class Switch extends Component {
  static override template = xml`
    <button
      type="button"
      role="switch"
      t-att-aria-checked="props.checked ? 'true' : 'false'"
      t-att-aria-label="props.label"
      t-att-class="trackClass"
      t-on-click="toggle"
    >
      <span t-att-class="thumbClass"/>
    </button>`;
  static override props = {
    checked: Boolean,
    onChange: Function,
    label: { type: String, optional: true },
  };

  get trackClass(): string {
    const tone = this.props.checked ? 'bg-verified' : 'bg-ink-300';
    return (
      `inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent ${tone} ` +
      'transition-colors duration-micro ease-onsite focus-visible:outline-none focus-visible:ring-2 ' +
      'focus-visible:ring-ink-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
    );
  }

  get thumbClass(): string {
    const offset = this.props.checked ? 'translate-x-[22px]' : 'translate-x-0.5';
    return `pointer-events-none block h-5 w-5 rounded-full bg-white shadow-card transition-transform duration-micro ease-onsite ${offset}`;
  }

  toggle() {
    this.props.onChange(!this.props.checked);
  }
}
