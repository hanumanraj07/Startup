import { Component, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';

export class StatusRow extends Component {
  static override template = xml`
    <div t-att-class="rowClass">
      <Icon name="props.verified ? 'circle-check' : 'circle-dashed'" size="16"/>
      <t t-out="props.label"/>
    </div>`;
  static components = { Icon };
  static override props = {
    verified: Boolean,
    label: String,
  };

  get rowClass(): string {
    return `flex items-center gap-2 text-sm ${this.props.verified ? 'text-verified' : 'text-ink-400'}`;
  }
}
