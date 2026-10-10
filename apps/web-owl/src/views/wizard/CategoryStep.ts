import { Component, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { Icon } from '@/components/Icon';
import { Spinner } from '@/components/Spinner';
import type { CategoryView } from '@/lib/api-types';

/** Step 1: pick one of the launch categories. */
export class CategoryStep extends Component {
  static override template = xml`
    <div t-if="props.loading" class="flex items-center gap-2 text-sm text-ink-500">
      <Spinner/> Loading categories…
    </div>
    <div t-else="" class="flex flex-col gap-3">
      <h2 class="text-lg font-medium text-ink-900">What do you need done?</h2>
      <div class="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Category">
        <button
          t-foreach="props.categories" t-as="c" t-key="c.id"
          type="button" role="radio"
          t-att-aria-checked="isActive(c) ? 'true' : 'false'"
          t-att-class="cardClass(c)"
          t-on-click="() => props.onSelect(c)"
        >
          <span t-if="isActive(c)" class="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white">
            <Icon name="'check'" size="12"/>
          </span>
          <Icon name="c.icon" size="20" class="isActive(c) ? 'text-brand-600' : 'text-ink-500'"/>
          <span class="font-medium text-ink-900" t-out="c.name"/>
          <span class="text-sm text-ink-500" t-out="c.description"/>
          <span class="tabular text-xs text-ink-400">Typically <t t-out="range(c)"/></span>
        </button>
      </div>
    </div>`;
  static components = { Icon, Spinner };
  static override props = {
    categories: Array,
    selectedId: String,
    loading: Boolean,
    onSelect: Function,
  };

  isActive(c: CategoryView): boolean {
    return c.id === this.props.selectedId;
  }

  range(c: CategoryView): string {
    return `${formatPaise(c.suggestedMinPaise)}–${formatPaise(c.suggestedMaxPaise)}`;
  }

  cardClass(c: CategoryView): string {
    const tone = this.isActive(c) ? 'border-brand-600 bg-brand-50' : 'border-line bg-paper-0 hover:bg-paper-100';
    return (
      `relative flex flex-col gap-2 rounded-card border p-4 text-left transition-colors duration-base ease-onsite ` +
      `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tone}`
    );
  }
}
