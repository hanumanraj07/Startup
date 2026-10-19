import { Component, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { MAX_ITEM_BUDGET_PAISE, MAX_TASK_BUDGET_PAISE, MIN_TASK_BUDGET_PAISE } from '@onsite/validation';
import { MoneyBreakdown } from '@/components/MoneyBreakdown';
import { Switch } from '@/components/Switch';
import { TextAreaField } from '@/components/TextAreaField';
import { TextField } from '@/components/TextField';
import { minDeadlineLocal } from '@/lib/wizard';

/**
 * Step 3: title, instructions, deadline and the price. The requester sets the
 * task payment themselves (no per-category ranges, founder decision
 * 2026-10-19). On a delivery they can also have something bought, with an item
 * budget that is held separately and never charged commission. The live
 * summary shows only what they will pay.
 */
export class DetailsStep extends Component {
  static override template = xml`
    <div class="flex flex-col gap-4">
      <h2 class="text-lg font-medium text-ink-900">The details</h2>
      <TextField id="'title'" label="'Task title'" maxlength="120"
        hint="'Specific enough that a stranger knows exactly what to do.'"
        value="props.wizard.title" onInput="(v) => props.onField('title', v)"/>
      <TextAreaField id="'description'" label="'Instructions'" rows="5" maxlength="5000"
        hint="instructionsHint"
        value="props.wizard.description" onInput="(v) => props.onField('description', v)"/>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField id="'deadline'" label="'Deadline'" type="'datetime-local'" min="minDeadline"
          value="props.wizard.deadlineLocal" onInput="(v) => props.onField('deadlineLocal', v)"/>
        <TextField id="'budget'" label="'Task payment (₹)'" type="'number'" min="minBudget" max="maxBudget"
          hint="paymentHint"
          value="props.wizard.budgetRupees" onInput="(v) => props.onField('budgetRupees', v)"/>
      </div>

      <div t-if="isDelivery" class="flex flex-col gap-3 rounded-card border border-line p-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="font-medium text-ink-900">Buy something for me</p>
            <p class="text-sm text-ink-500">The worker pays at the shop and gets it back on approval. Say exactly what to buy in the instructions.</p>
          </div>
          <Switch checked="props.wizard.buyItem" onChange="props.onBuyItem" label="'Buy something for me'"/>
        </div>
        <TextField t-if="props.wizard.buyItem" id="'item-budget'" label="'Item budget (₹)'" type="'number'"
          min="'1'" max="maxItem" hint="itemHint"
          value="props.wizard.itemRupees" onInput="(v) => props.onField('itemRupees', v)"/>
      </div>

      <MoneyBreakdown t-if="props.estimate" money="props.estimate"/>
    </div>`;
  static components = { MoneyBreakdown, Switch, TextAreaField, TextField };
  static override props = {
    wizard: Object,
    onField: Function,
    onBuyItem: Function,
    estimate: { type: Object, optional: true },
  };

  minDeadline = minDeadlineLocal();
  minBudget = String(MIN_TASK_BUDGET_PAISE / 100);
  maxBudget = String(MAX_TASK_BUDGET_PAISE / 100);
  maxItem = String(MAX_ITEM_BUDGET_PAISE / 100);

  get isDelivery(): boolean {
    return this.props.wizard.category?.locationMode === 'PICKUP_DROPOFF';
  }

  get instructionsHint(): string {
    return this.isDelivery && this.props.wizard.buyItem
      ? 'What to buy (brand, size, colour), what to do if it is out of stock, and who to hand it to.'
      : 'Say what to check, and what NOT to do (e.g. do not purchase).';
  }

  get paymentHint(): string {
    return `What you pay the worker for doing it. At least ${formatPaise(MIN_TASK_BUDGET_PAISE)}.`;
  }

  get itemHint(): string {
    return `The most they may spend, up to ${formatPaise(MAX_ITEM_BUDGET_PAISE)}. They send a photo of the receipt.`;
  }
}
