import { Component, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { MAX_TASK_BUDGET_PAISE, MIN_TASK_BUDGET_PAISE } from '@onsite/validation';
import { MoneyBreakdown } from '@/components/MoneyBreakdown';
import { TextAreaField } from '@/components/TextAreaField';
import { TextField } from '@/components/TextField';
import { minDeadlineLocal } from '@/lib/wizard';

/** Step 3: title, instructions, deadline and budget, with a live estimate of the split. */
export class DetailsStep extends Component {
  static override template = xml`
    <div class="flex flex-col gap-4">
      <h2 class="text-lg font-medium text-ink-900">The details</h2>
      <TextField id="'title'" label="'Task title'" maxlength="120"
        hint="'Specific enough that a stranger knows exactly what to do.'"
        value="props.wizard.title" onInput="(v) => props.onField('title', v)"/>
      <TextAreaField id="'description'" label="'Instructions'" rows="5" maxlength="5000"
        hint="'Say what to check, and what NOT to do (e.g. do not purchase).'"
        value="props.wizard.description" onInput="(v) => props.onField('description', v)"/>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField id="'deadline'" label="'Deadline'" type="'datetime-local'" min="minDeadline"
          value="props.wizard.deadlineLocal" onInput="(v) => props.onField('deadlineLocal', v)"/>
        <TextField id="'budget'" label="'Budget (₹)'" type="'number'" min="minBudget" max="maxBudget"
          hint="budgetHint"
          value="props.wizard.budgetRupees" onInput="(v) => props.onField('budgetRupees', v)"/>
      </div>
      <MoneyBreakdown t-if="props.estimate"
        budgetPaise="props.estimate.budgetPaise"
        commissionPaise="props.estimate.commissionPaise"
        workerPayoutPaise="props.estimate.workerPayoutPaise"
        estimate="true"/>
    </div>`;
  static components = { MoneyBreakdown, TextAreaField, TextField };
  static override props = {
    wizard: Object,
    onField: Function,
    estimate: { type: Object, optional: true },
  };

  minDeadline = minDeadlineLocal();
  minBudget = String(MIN_TASK_BUDGET_PAISE / 100);
  maxBudget = String(MAX_TASK_BUDGET_PAISE / 100);

  get budgetHint(): string | undefined {
    const category = this.props.wizard.category;
    return category
      ? `Typically ${formatPaise(category.suggestedMinPaise)}–${formatPaise(category.suggestedMaxPaise)}`
      : undefined;
  }
}
