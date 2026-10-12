import { Component, xml } from '@odoo/owl';
import { Icon } from './Icon';

/** A friendly empty list: an icon on a yellow disc with two confetti dots, a title and a hint. */
export class EmptyState extends Component {
  static override template = xml`
    <div class="flex flex-col items-center gap-4 rounded-sheet bg-paper-0 px-6 py-14 text-center shadow-card">
      <span class="relative flex h-20 w-20 items-center justify-center rounded-full bg-tint-yellow text-brand-700">
        <span class="absolute -right-1 top-1 h-4 w-4 rounded-full bg-brand-solid" aria-hidden="true"/>
        <span class="absolute -left-2 bottom-2 h-2.5 w-2.5 rounded-full bg-accent-500" aria-hidden="true"/>
        <Icon name="props.icon or 'inbox'" size="34"/>
      </span>
      <div>
        <p class="text-lg font-bold text-ink-900" t-out="props.title"/>
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
