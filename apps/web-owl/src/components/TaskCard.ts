import { Component, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import type { FeedTask } from '@/lib/api-types';
import { hoursLeft } from '@/lib/format';
import { btn, card } from '@/ui/classes';
import { Icon } from './Icon';

/**
 * A worker-feed card, like an Odoo kanban card. Distance and payout are what a
 * worker reads first (docs/19-ui-design-system.md), so they get the most
 * visual weight: larger, tabular, at the top of the card.
 */
export class TaskCard extends Component {
  static override template = xml`
    <div t-att-class="cardClass">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-2 text-sm text-ink-500">
          <Icon name="props.task.categoryIcon" size="16"/>
          <t t-out="props.task.categoryName"/>
        </div>
        <span class="tabular text-lg font-bold text-verified" t-out="payout"/>
      </div>

      <h3 class="mt-2 text-base font-semibold text-ink-900" t-out="props.task.title"/>

      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-500">
        <span class="tabular flex items-center gap-1">
          <Icon name="'map-pin'" size="14"/>
          <t t-out="props.task.distanceLabel"/> · <t t-out="props.task.approximateAddress"/>
        </span>
        <span class="tabular flex items-center gap-1">
          <Icon name="'clock'" size="14"/>
          <t t-out="hoursLeft"/>h left
        </span>
      </div>

      <div class="mt-3 flex items-center justify-between border-t border-line pt-3">
        <span class="flex items-center gap-1.5 text-sm text-ink-500">
          <Icon name="'shield-check'" size="14"/>
          <t t-out="props.task.requester.displayName"/> · level <t t-out="props.task.requester.verificationLevel"/>
        </span>
        <button type="button" t-att-class="acceptClass" t-att-disabled="props.accepting" t-att-aria-busy="props.accepting ? 'true' : null" t-on-click="accept">
          <span
            t-if="props.accepting"
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white"
            aria-hidden="true"
          />
          Accept
        </button>
      </div>
    </div>`;
  static components = { Icon };
  static override props = {
    task: Object,
    onAccept: Function,
    accepting: Boolean,
  };

  cardClass = card('p-4 transition-shadow duration-base ease-onsite hover:shadow-float');
  acceptClass = btn('primary', 'sm');

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

const BAR = 'animate-pulse rounded bg-paper-100';

/** Shape-matched loading placeholder for TaskCard: docs/19 says skeletons match content, never a bare spinner. */
export class TaskCardSkeleton extends Component {
  static override template = xml`
    <div t-att-class="cardClass" aria-hidden="true">
      <div class="flex items-start justify-between gap-3">
        <div class="h-4 w-32 ${BAR}"/>
        <div class="h-5 w-16 ${BAR}"/>
      </div>
      <div class="mt-3 h-5 w-3/4 ${BAR}"/>
      <div class="mt-3 flex gap-4">
        <div class="h-4 w-24 ${BAR}"/>
        <div class="h-4 w-16 ${BAR}"/>
      </div>
      <div class="mt-3 flex items-center justify-between border-t border-line pt-3">
        <div class="h-4 w-28 ${BAR}"/>
        <div class="h-8 w-20 ${BAR}"/>
      </div>
    </div>`;
  static override props = {};

  cardClass = card('p-4');
}
