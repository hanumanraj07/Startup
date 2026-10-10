import { Component, xml } from '@odoo/owl';
import { card } from '@/ui/classes';
import { Icon } from '../Icon';

export interface AdminProof {
  type: string;
  url: string | null;
  distanceFromTaskMeters: number | null;
  verificationFlags: string[];
  capturedAt: string | null;
  fieldKey: string | null;
  fieldValue: string | null;
  noteBody: string | null;
}

/**
 * One proof as an admin sees it: the media, any structured answer or note, the
 * server-measured distance from the task, and every verification flag. Flags
 * are never softened (calm tier: evidence is shown as it is).
 */
export class EvidenceCard extends Component {
  static override template = xml`
    <div t-att-class="cardClass">
      <img t-if="proof.url and proof.type === 'PHOTO'" t-att-src="proof.url" alt="Evidence" class="aspect-video w-full object-cover"/>
      <video t-elif="proof.url and proof.type === 'VIDEO'" t-att-src="proof.url" controls="controls" class="aspect-video w-full bg-black"/>
      <div class="flex flex-col gap-1 p-3 text-sm">
        <p t-if="proof.fieldKey"><t t-out="proof.fieldKey"/>: <span class="font-medium" t-out="proof.fieldValue"/></p>
        <p t-if="proof.noteBody" class="text-ink-700" t-out="proof.noteBody"/>
        <p t-if="proof.distanceFromTaskMeters !== null" class="tabular text-xs text-ink-400"><t t-out="distance"/> m from task</p>
        <p t-foreach="proof.verificationFlags" t-as="flag" t-key="flag" class="flex items-center gap-1 text-xs font-medium text-progress">
          <Icon name="'alert-triangle'" size="12"/> <t t-out="flagLabel(flag)"/>
        </p>
      </div>
    </div>`;
  static components = { Icon };
  static override props = { proof: Object };

  cardClass = card('overflow-hidden');

  get proof(): AdminProof {
    return this.props.proof as AdminProof;
  }

  get distance(): number {
    return Math.round(this.proof.distanceFromTaskMeters ?? 0);
  }

  flagLabel(flag: string): string {
    return flag.replace(/_/g, ' ');
  }
}
