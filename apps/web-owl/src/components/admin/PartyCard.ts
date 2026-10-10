import { Component, xml } from '@odoo/owl';
import { card } from '@/ui/classes';

export interface AdminParty {
  displayName: string;
  verificationLevel: number;
  ratingAvg?: number | null;
  completionRate?: number | null;
  priorDisputes?: number;
}

/** A requester or worker as an admin sees them: level, rating and history, no contact details. */
export class PartyCard extends Component {
  static override template = xml`
    <div t-att-class="cardClass">
      <span class="text-xs uppercase tracking-wide text-ink-400" t-out="props.label"/>
      <span class="font-medium text-ink-900" t-out="party.displayName"/>
      <span class="text-sm text-ink-500" t-out="summary"/>
    </div>`;
  static override props = { label: String, party: Object };

  cardClass = card('flex flex-col gap-1 p-4');

  get party(): AdminParty {
    return this.props.party as AdminParty;
  }

  get summary(): string {
    const p = this.party;
    let text = `Level ${p.verificationLevel}`;
    if (p.ratingAvg != null) text += ` · ${p.ratingAvg.toFixed(1)}★`;
    if (p.completionRate != null) text += ` · ${Math.round(p.completionRate)}% completion`;
    if (p.priorDisputes !== undefined) text += ` · ${p.priorDisputes} prior disputes`;
    return text;
  }
}
