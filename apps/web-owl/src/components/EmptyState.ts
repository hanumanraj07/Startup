import { Component, xml } from '@odoo/owl';
import { Icon } from './Icon';

export class EmptyState extends Component {
  static override template = xml`
    <div class="flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-paper-0 px-6 py-12 text-center">
      <Icon name="props.icon or 'inbox'" size="32" class="'text-ink-300'"/>
      <div>
        <p class="font-medium text-ink-900" t-out="props.title"/>
        <p class="mt-1 text-sm text-ink-500" t-out="props.description"/>
      </div>
    </div>`;
  static components = { Icon };
  static override props = {
    title: String,
    description: String,
    icon: { type: String, optional: true },
  };
}
