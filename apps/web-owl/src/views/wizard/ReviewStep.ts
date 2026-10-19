import { Component, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { MoneyBreakdown } from '@/components/MoneyBreakdown';
import type { ProofRequirement } from '@/lib/api-types';
import { formatDateTime } from '@/lib/format';
import { composeAddress } from '@/lib/wizard';
import { btn } from '@/ui/classes';

export interface DraftTask {
  id: string;
  title: string;
  money: { budgetPaise: number; commissionPaise: number; workerPayoutPaise: number };
}

/**
 * Step 5, in two phases. Before the draft exists: review and "Create task".
 * After: the server's real numbers and "Fund and publish". This is a money
 * screen, so it stays calm: flat, high-contrast, no decoration.
 */
export class ReviewStep extends Component {
  static override template = xml`
    <div t-if="props.draft" class="flex flex-col gap-4">
      <h2 class="text-lg font-medium text-ink-900">Confirm and pay</h2>
      <p class="text-sm text-ink-500">Your task is saved as a draft. This is the real amount — nothing changes at payment.</p>
      <MoneyBreakdown
        budgetPaise="props.draft.money.budgetPaise"
        commissionPaise="props.draft.money.commissionPaise"
        workerPayoutPaise="props.draft.money.workerPayoutPaise"/>
      <p t-if="props.submitError" role="alert" class="text-sm text-dispute" t-out="props.submitError"/>
      <button type="button" t-att-class="payClass" t-att-disabled="props.submitting" t-att-aria-busy="props.submitting ? 'true' : null"
        t-on-click="props.onFundAndPublish">
        <span t-if="props.submitting" class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" aria-hidden="true"/>
        Fund <t t-out="amount"/> and publish
      </button>
    </div>

    <div t-else="" class="flex flex-col gap-4">
      <h2 class="text-lg font-medium text-ink-900">Review before you create it</h2>
      <dl class="flex flex-col gap-2 text-sm">
        <div t-foreach="rows" t-as="row" t-key="row.label" class="flex justify-between gap-4 border-b border-line pb-2">
          <dt class="text-ink-500" t-out="row.label"/>
          <dd class="text-right text-ink-900" t-out="row.value"/>
        </div>
      </dl>
      <p class="whitespace-pre-wrap rounded-card bg-paper-100 p-3 text-sm text-ink-700" t-out="props.wizard.description"/>
      <MoneyBreakdown t-if="props.estimate"
        budgetPaise="props.estimate.budgetPaise"
        commissionPaise="props.estimate.commissionPaise"
        workerPayoutPaise="props.estimate.workerPayoutPaise"
        estimate="true"/>
      <p t-if="props.submitError" role="alert" class="text-sm text-dispute" t-out="props.submitError"/>
      <button type="button" t-att-class="createClass" t-att-disabled="props.submitting" t-att-aria-busy="props.submitting ? 'true' : null"
        t-on-click="props.onCreateDraft">
        <span t-if="props.submitting" class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" aria-hidden="true"/>
        Create task
      </button>
    </div>`;
  static components = { MoneyBreakdown };
  static override props = {
    wizard: Object,
    draft: { type: Object, optional: true },
    estimate: { type: Object, optional: true },
    submitting: Boolean,
    submitError: { type: String, optional: true },
    onCreateDraft: Function,
    onFundAndPublish: Function,
  };

  createClass = btn('primary', 'default', 'w-full');
  payClass = btn('primary', 'lg', 'w-full');

  get amount(): string {
    const draft = this.props.draft as DraftTask | undefined;
    return draft ? formatPaise(draft.money.budgetPaise) : '';
  }

  get rows(): { label: string; value: string }[] {
    const w = this.props.wizard;
    const requirements = w.proofRequirements as ProofRequirement[];
    return [
      { label: 'Category', value: w.category?.name ?? '' },
      { label: 'Title', value: w.title },
      ...(w.category?.locationMode === 'PICKUP_DROPOFF'
        ? [
            { label: 'Pickup', value: composeAddress(w.pickup) },
            { label: 'Drop-off', value: composeAddress(w.dropoff) },
          ]
        : [{ label: 'Location', value: composeAddress(w.pickup) }]),
      { label: 'Deadline', value: w.deadlineLocal ? formatDateTime(w.deadlineLocal) : '' },
      { label: 'Proof required', value: requirements.map((r) => r.label).join(', ') },
    ];
  }
}
