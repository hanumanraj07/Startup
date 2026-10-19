import { Component, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import type { RequesterMoney } from '@/lib/api-types';

interface Row {
  label: string;
  value: string;
  hint?: string;
  muted?: boolean;
  total?: boolean;
}

const money = (paise: number) => formatPaise(paise, { forceDecimals: true });

/**
 * What a requester pays, and nothing about how it divides: the platform's
 * commission and the worker's net earnings are never shown to either side
 * (founder decision 2026-10-19). With an item, the item budget is its own line,
 * and once the worker reports what it cost, so are the cost and the refund.
 * docs/19-ui-design-system.md: money screens are calm and explicit, with
 * tabular numerals so the figures align.
 */
export class MoneyBreakdown extends Component {
  static override template = xml`
    <div class="flex flex-col gap-3 rounded-card border border-line bg-paper-100 p-4">
      <t t-foreach="rows" t-as="row" t-key="row.label">
        <div t-if="row.total" class="h-px bg-line"/>
        <div class="flex items-start justify-between gap-4 text-[15px]">
          <div class="min-w-0">
            <span t-att-class="row.total ? 'font-semibold text-ink-900' : row.muted ? 'text-ink-500' : 'text-ink-900'" t-out="row.label"/>
            <p t-if="row.hint" class="text-xs text-ink-400" t-out="row.hint"/>
          </div>
          <span t-att-class="valueClass(row)" t-out="row.value"/>
        </div>
      </t>
    </div>`;
  static override props = {
    money: Object,
    /** "Total to pay" before payment, "You paid" after. */
    paid: { type: Boolean, optional: true },
  };

  get rows(): Row[] {
    const m = this.props.money as RequesterMoney;
    const rows: Row[] = [{ label: 'Task payment', value: money(m.taskPaymentPaise), hint: 'For the worker doing the task' }];
    if (m.itemBudgetPaise > 0) {
      rows.push({
        label: 'Item budget',
        value: money(m.itemBudgetPaise),
        hint: 'The most the worker may spend. Unspent money comes back to you.',
      });
    }
    rows.push({ label: this.props.paid ? 'You paid' : 'Total to pay', value: money(m.totalPaise), total: true });
    if (m.itemSpentPaise !== null) {
      rows.push({ label: 'Item cost, from the receipt', value: money(m.itemSpentPaise), muted: true });
      if ((m.itemRefundPaise ?? 0) > 0) {
        rows.push({ label: 'Unspent item budget, back to you', value: money(m.itemRefundPaise ?? 0), muted: true });
      }
    }
    return rows;
  }

  valueClass(row: Row): string {
    if (row.total) return 'tabular shrink-0 text-lg font-bold text-ink-900';
    return row.muted ? 'tabular shrink-0 text-ink-500' : 'tabular shrink-0 font-semibold text-ink-900';
  }
}

/**
 * What a worker gets: their earnings, and an item budget shown apart from
 * them, because it is money they spend at the shop and get back, not income.
 */
export class WorkerEarnings extends Component {
  static override template = xml`
    <div class="flex flex-col gap-3 rounded-card border border-line bg-paper-100 p-4">
      <div class="flex items-center justify-between gap-4">
        <span class="text-[15px] text-ink-900">You earn</span>
        <span class="tabular text-2xl font-bold text-verified" t-out="earn"/>
      </div>
      <t t-if="props.item">
        <div class="h-px bg-line"/>
        <div class="flex items-start justify-between gap-4 text-[15px]">
          <div class="min-w-0">
            <span class="text-ink-900">Item budget</span>
            <p class="text-xs text-ink-400">You pay at the shop, keep the receipt, and get it back with your earnings. Never spend more than this.</p>
          </div>
          <span class="tabular shrink-0 font-semibold text-ink-900" t-out="itemBudget"/>
        </div>
        <div t-if="props.item.spentPaise !== null" class="flex items-center justify-between gap-4 text-[15px]">
          <span class="text-ink-500">Item cost you reported</span>
          <span class="tabular shrink-0 text-ink-500" t-out="itemSpent"/>
        </div>
      </t>
    </div>`;
  static override props = {
    payoutPaise: Number,
    /** Pass undefined, not null, when nothing is bought. */
    item: { type: Object, optional: true },
  };

  get earn(): string {
    return formatPaise(this.props.payoutPaise);
  }

  get itemBudget(): string {
    return money(this.props.item.budgetPaise);
  }

  get itemSpent(): string {
    return money(this.props.item.spentPaise);
  }
}
