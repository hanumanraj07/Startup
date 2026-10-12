import { Component, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import type { FeedTask } from '@/lib/api-types';
import { hoursLeft } from '@/lib/format';
import { btn, card, tappableCard } from '@/ui/classes';
import { CategoryBadge } from './CategoryBadge';
import { Icon } from './Icon';

/**
 * A worker-feed card. Distance and payout are what a
 * worker reads first (docs/19-ui-design-system.md), so they get the most
 * visual weight: the payout as a green chip, the distance as the first pill.
 */
export class TaskCard extends Component {
  static override template = xml`
    <div t-att-class="cardClass">
      <div class="flex items-start gap-3">
        <CategoryBadge slug="props.task.categorySlug" size="44"/>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-400" t-out="props.task.categoryName"/>
          <h3 class="mt-0.5 text-base font-bold leading-snug text-ink-900" t-out="props.task.title"/>
        </div>
        <span class="tabular shrink-0 rounded-full bg-tint-green px-3 py-1 text-base font-extrabold text-verified" t-out="payout"/>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-700">
        <span class="tabular inline-flex items-center gap-1 rounded-full bg-paper-100 px-2.5 py-1 font-semibold">
          <Icon name="'navigation'" size="14"/>
          <t t-out="props.task.distanceLabel"/>
        </span>
        <span class="tabular inline-flex items-center gap-1 rounded-full bg-paper-100 px-2.5 py-1">
          <Icon name="'clock'" size="14"/>
          <t t-out="hoursLeft"/>h left
        </span>
        <span class="inline-flex min-w-0 items-center gap-1 text-ink-500">
          <Icon name="'map-pin'" size="14" class="'shrink-0'"/>
          <span class="truncate" t-out="props.task.approximateAddress"/>
        </span>
      </div>

      <div class="mt-4 flex items-center justify-between gap-3 border-t border-line-light pt-3">
        <span class="flex min-w-0 items-center gap-1.5 text-sm text-ink-500">
          <Icon name="'shield-check'" size="14" class="'shrink-0 text-verified'"/>
          <span class="truncate"><t t-out="props.task.requester.displayName"/> · level <t t-out="props.task.requester.verificationLevel"/></span>
        </span>
        <button type="button" t-att-class="acceptClass" t-att-disabled="props.accepting" t-att-aria-busy="props.accepting ? 'true' : null" t-on-click="accept">
          <span
            t-if="props.accepting"
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black"
            aria-hidden="true"
          />
          Accept
        </button>
      </div>
    </div>`;
  static components = { CategoryBadge, Icon };
  static override props = {
    task: Object,
    onAccept: Function,
    accepting: Boolean,
  };

  cardClass = tappableCard('p-4');
  acceptClass = btn('primary', 'default', 'shrink-0 px-6');

  get payout(): string {
    return formatPaise((this.props.task as FeedTask).payoutPaise);
  }

  get hoursLeft(): number {
    return hoursLeft((this.props.task as FeedTask).deadlineAt);
  }

  accept() {
    this.props.onAccept((this.props.task as FeedTask).id);
  }
}

const BAR = 'skeleton rounded-md';

/** Shape-matched loading placeholder for TaskCard: docs/19 says skeletons match content, never a bare spinner. */
export class TaskCardSkeleton extends Component {
  static override template = xml`
    <div t-att-class="cardClass" aria-hidden="true">
      <div class="flex items-start gap-3">
        <div class="skeleton h-11 w-11 shrink-0 rounded-[30%]"/>
        <div class="flex flex-1 flex-col gap-2"><div class="h-3 w-24 ${BAR}"/><div class="h-5 w-3/4 ${BAR}"/></div>
        <div class="skeleton h-7 w-16 rounded-full"/>
      </div>
      <div class="mt-3 flex gap-2">
        <div class="skeleton h-7 w-20 rounded-full"/>
        <div class="skeleton h-7 w-20 rounded-full"/>
        <div class="h-4 w-28 self-center ${BAR}"/>
      </div>
      <div class="mt-4 flex items-center justify-between border-t border-line-light pt-3">
        <div class="h-4 w-28 ${BAR}"/>
        <div class="skeleton h-11 w-24 rounded-input"/>
      </div>
    </div>`;
  static override props = {};

  cardClass = card('p-4');
}
