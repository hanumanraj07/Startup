import { Component, xml } from '@odoo/owl';
import type { ProofRequirement, ProofView } from '@/lib/api-types';
import { Icon } from './Icon';
import { proofTypeIconName } from './ProofTile';

interface ChecklistRow {
  met: boolean;
  icon: string;
  text: string;
}

/**
 * Required proof against what has actually been captured. A UI convenience
 * only: POST /tasks/:id/submit is the real authority on whether requirements
 * are met (docs/16-security-requirements.md), and its error is what shows if
 * this checklist and the server ever disagree.
 */
export class ProofChecklist extends Component {
  static override template = xml`
    <ul class="flex flex-col gap-2">
      <li t-foreach="rows" t-as="row" t-key="row_index" class="flex items-center gap-2 text-sm">
        <Icon name="row.met ? 'check' : 'circle'" size="16" class="row.met ? 'shrink-0 text-verified' : 'shrink-0 text-ink-300'"/>
        <Icon name="row.icon" size="14" class="'shrink-0 text-ink-400'"/>
        <span t-att-class="row.met ? 'text-ink-900' : 'text-ink-500'" t-out="row.text"/>
      </li>
    </ul>`;
  static components = { Icon };
  static override props = {
    requirements: Array,
    proofs: Array,
  };

  get rows(): ChecklistRow[] {
    const requirements = this.props.requirements as ProofRequirement[];
    const proofs = this.props.proofs as ProofView[];
    return requirements.map((req) => {
      const count = proofs.filter((p) => p.type === req.type && (!req.fieldKey || p.fieldKey === req.fieldKey)).length;
      const met = count >= (req.minCount ?? 1);
      const progress = req.minCount && req.minCount > 1 ? ` (${count}/${req.minCount})` : '';
      const optional = !req.required ? ' — optional' : '';
      return { met, icon: proofTypeIconName(req.type), text: `${req.label}${progress}${optional}` };
    });
  }
}
