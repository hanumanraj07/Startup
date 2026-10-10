import { Component, xml } from '@odoo/owl';
import { btn } from '@/ui/classes';

/** A full-width primary submit button that shows a spinner and disables itself while busy. */
export class SubmitButton extends Component {
  static override template = xml`
    <button type="submit" t-att-class="buttonClass" t-att-disabled="props.busy" t-att-aria-busy="props.busy ? 'true' : null">
      <span
        t-if="props.busy"
        class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white"
        aria-hidden="true"
      />
      <t t-out="props.label"/>
    </button>`;
  static override props = {
    label: String,
    busy: Boolean,
  };

  buttonClass = btn('primary', 'default', 'w-full');
}
