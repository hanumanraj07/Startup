import { Component, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { CategoryBadge } from '@/components/CategoryBadge';
import type { CategoryView } from '@/lib/api-types';

/** Step 1: pick one of the launch categories. */
export class CategoryStep extends Component {
  static override template = xml`
    <div t-if="props.loading" class="flex flex-col gap-3" aria-busy="true">
      <div class="skeleton h-6 w-56 rounded-md"/>
      <div class="grid gap-3 sm:grid-cols-2">
        <div t-foreach="[0, 1, 2, 3, 4, 5]" t-as="i" t-key="i" class="flex flex-col gap-2 rounded-card border border-line-light bg-paper-0 p-4">
          <div class="skeleton h-11 w-11 rounded-[30%]"/>
          <div class="skeleton h-4 w-32 rounded-md"/>
          <div class="skeleton h-3 w-48 rounded-md"/>
        </div>
      </div>
    </div>
    <div t-else="" class="flex flex-col gap-3">
      <h2 class="text-xl font-bold tracking-tight text-ink-900">What do you need done?</h2>
      <div class="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Category">
        <button
          t-foreach="props.categories" t-as="c" t-key="c.id"
          type="button" role="radio"
          t-att-aria-checked="isActive(c) ? 'true' : 'false'"
          t-att-class="cardClass(c)"
          t-on-click="() => props.onSelect(c)"
        >
          <span t-if="isActive(c)" class="pop-in absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-brand-solid">
            <Icon name="'check'" size="14"/>
          </span>
          <CategoryBadge slug="c.slug" size="44"/>
          <span class="font-bold text-ink-900" t-out="c.name"/>
          <span class="text-sm text-ink-500" t-out="c.description"/>
          <span class="text-xs font-medium text-ink-400" t-out="modeLabel(c)"/>
        </button>
      </div>
    </div>`;
  static components = { CategoryBadge, Icon };
  static override props = {
    categories: Array,
    selectedId: String,
    loading: Boolean,
    onSelect: Function,
  };

  isActive(c: CategoryView): boolean {
    return c.id === this.props.selectedId;
  }

  /** What the next step will ask for. No price range: the requester sets the price (founder decision 2026-10-19). */
  modeLabel(c: CategoryView): string {
    return c.locationMode === 'PICKUP_DROPOFF' ? 'Pickup and drop-off · can include buying an item' : 'One place';
  }

  cardClass(c: CategoryView): string {
    const tone = this.isActive(c)
      ? 'border-ink-900 bg-brand-50 shadow-card'
      : 'border-line-light bg-paper-0 shadow-card hover:-translate-y-0.5 hover:border-line hover:shadow-float';
    return (
      `relative flex flex-col gap-2 rounded-card border-2 p-4 text-left transition-[border-color,background-color,box-shadow,transform] duration-base ease-onsite active:scale-[0.98] ` +
      `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 ${tone}`
    );
  }
}
