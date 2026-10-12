import { Component, xml } from '@odoo/owl';

export interface TabItem {
  value: string;
  label: string;
}

/** A segmented tab bar (`role="tablist"`). Controlled: the parent owns `value` and updates it from `onChange`. */
export class Tabs extends Component {
  static override template = xml`
    <div role="tablist" class="inline-flex items-center gap-1 rounded-full bg-paper-100 p-1">
      <button
        t-foreach="props.tabs" t-as="tab" t-key="tab.value"
        type="button" role="tab"
        t-att-aria-selected="tab.value === props.value ? 'true' : 'false'"
        t-att-class="tabClass(tab.value)"
        t-on-click="() => props.onChange(tab.value)"
      ><t t-out="tab.label"/></button>
    </div>`;
  static override props = {
    tabs: Array,
    value: String,
    onChange: Function,
  };

  tabClass(value: string): string {
    const base =
      'min-h-[38px] rounded-full px-4 text-sm font-semibold transition-colors duration-micro ease-onsite ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900';
    return value === this.props.value
      ? `${base} bg-ink-900 text-white shadow-card`
      : `${base} text-ink-500 hover:text-ink-900`;
  }
}
