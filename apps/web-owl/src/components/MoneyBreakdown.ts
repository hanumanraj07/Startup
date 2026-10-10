import { Component, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';

interface Row {
  label: string;
  value: string;
  muted?: boolean;
  emphasize?: boolean;
}

/**
 * Always shows all three figures together (budget, commission, payout), never
 * collapsed to one. docs/19-ui-design-system.md: money screens are calm and
 * explicit, and tabular numerals are mandatory so the figures align.
 */
export class MoneyBreakdown extends Component {
  static override template = xml`
    <div class="flex flex-col gap-3 rounded-card border border-line bg-paper-100 p-4">
      <p t-if="props.estimate" class="text-xs uppercase tracking-wide text-ink-400">Estimate — confirmed exactly at payment</p>
      <t t-foreach="rows" t-as="row" t-key="row.label">
        <div t-if="row.label === 'Worker receives'" class="h-px bg-line"/>
        <div class="flex items-center justify-between text-[15px]">
          <span t-att-class="row.muted ? 'text-ink-500' : 'text-ink-900'" t-out="row.label"/>
          <span t-att-class="valueClass(row)" t-out="row.value"/>
        </div>
      </t>
    </div>`;
  static override props = {
    budgetPaise: Number,
    commissionPaise: Number,
    workerPayoutPaise: Number,
    estimate: { type: Boolean, optional: true },
  };

  get rows(): Row[] {
    const { budgetPaise, commissionPaise, workerPayoutPaise } = this.props;
    const money = (paise: number) => formatPaise(paise, { forceDecimals: true });
    return [
      { label: 'Task budget', value: money(budgetPaise) },
      { label: 'Platform commission', value: money(commissionPaise), muted: true },
      { label: 'Worker receives', value: money(workerPayoutPaise), emphasize: true },
    ];
  }

  valueClass(row: Row): string {
    if (row.emphasize) return 'tabular font-semibold text-verified';
    return row.muted ? 'tabular text-ink-500' : 'tabular font-semibold text-ink-900';
  }
}
