import { Component, xml } from '@odoo/owl';
import type { ProofView } from '@/lib/api-types';
import { formatDateTime } from '@/lib/format';
import { Icon } from './Icon';

const FLAG_LABELS: Record<string, string> = {
  gps_outside_geofence: 'Captured outside the task location',
  uploaded_long_after_capture: 'Uploaded well after it was captured',
};

/** The lucide icon name for a proof type. */
export function proofTypeIconName(type: ProofView['type']): string {
  return type === 'PHOTO' ? 'image' : type === 'VIDEO' ? 'video' : type === 'STRUCTURED_FIELD' ? 'hash' : 'file-text';
}

/**
 * One piece of evidence, shown with its verification metadata as facts, not
 * captions, including unfavourable ones. docs/19-ui-design-system.md: hiding
 * an outside-geofence flag "would destroy the only thing that makes the
 * evidence worth anything."
 */
export class ProofTile extends Component {
  static override template = xml`
    <div class="overflow-hidden rounded-card border border-line bg-paper-0">
      <img t-if="proof.url and proof.type === 'PHOTO'" t-att-src="proof.url" alt="Submitted proof" class="aspect-video w-full object-cover"/>
      <video t-elif="proof.url and proof.type === 'VIDEO'" t-att-src="proof.url" controls="" class="aspect-video w-full bg-black"/>
      <div t-else="" class="flex aspect-video w-full items-center justify-center bg-paper-100">
        <Icon name="proof.type === 'STRUCTURED_FIELD' ? 'hash' : 'file-text'" size="32" class="'text-ink-300'"/>
      </div>

      <div class="flex flex-col gap-1.5 p-3 text-sm">
        <p t-if="proof.fieldKey">
          <span class="text-ink-500"><t t-out="fieldLabel"/>:</span>
          <t t-out="' '"/>
          <span class="font-medium text-ink-900" t-out="proof.fieldValue"/>
        </p>
        <p t-if="proof.noteBody" class="whitespace-pre-wrap text-ink-700" t-out="proof.noteBody"/>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
          <span t-if="proof.capturedAt">Captured <t t-out="captured"/></span>
          <span t-if="proof.distanceFromTaskMeters !== null" class="tabular"><t t-out="distance"/> m from task location</span>
        </div>

        <div t-foreach="proof.verificationFlags" t-as="flag" t-key="flag" class="flex items-center gap-1.5 text-xs font-medium text-[#856404]">
          <Icon name="'alert-triangle'" size="14"/>
          <t t-out="flagLabel(flag)"/>
        </div>
      </div>
    </div>`;
  static components = { Icon };
  static override props = {
    proof: Object,
  };

  get proof(): ProofView {
    return this.props.proof as ProofView;
  }

  get fieldLabel(): string {
    return (this.proof.fieldKey ?? '').replace(/_/g, ' ');
  }

  get captured(): string {
    return this.proof.capturedAt ? formatDateTime(this.proof.capturedAt) : '';
  }

  get distance(): number {
    return Math.round(this.proof.distanceFromTaskMeters ?? 0);
  }

  flagLabel(flag: string): string {
    return FLAG_LABELS[flag] ?? flag;
  }
}
