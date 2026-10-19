import { Component, xml } from '@odoo/owl';
import type { ProofType } from '@onsite/types';
import { Icon } from '@/components/Icon';
import type { ProofRequirement } from '@/lib/api-types';
import { btn, input } from '@/ui/classes';

const PROOF_TYPE_LABELS: Record<ProofType, string> = {
  PHOTO: 'Photo',
  VIDEO: 'Video',
  NOTE: 'Written note',
  STRUCTURED_FIELD: 'Structured field',
  SIGNATURE: 'Signature',
};

/** Step 4: the evidence the worker must provide; pre-filled from the category and fully editable. */
export class ProofStep extends Component {
  static override template = xml`
    <div class="flex flex-col gap-4">
      <h2 class="text-lg font-medium text-ink-900">What proof do you need?</h2>
      <p class="text-sm text-ink-500">Pre-filled from the category. Adjust or add your own.</p>
      <div class="flex flex-col gap-3">
        <div t-foreach="props.requirements" t-as="r" t-key="r_index" class="flex flex-col gap-3 rounded-card border border-line p-3">
          <input t-att-class="labelClass" t-att-value="r.label" placeholder="What to capture, e.g. Sealed box photo"
            aria-label="Proof label" t-on-input="(ev) => onLabel(ev, r_index)"/>
          <div class="flex flex-wrap items-center gap-2">
            <select t-att-class="selectClass" aria-label="Proof type" t-on-change="(ev) => onType(ev, r_index)">
              <option t-foreach="typeOptions" t-as="opt" t-key="opt.value" t-att-value="opt.value"
                t-att-selected="opt.value === r.type" t-out="opt.label"/>
            </select>
            <label class="flex min-h-[44px] cursor-pointer items-center gap-2 whitespace-nowrap px-1 text-sm text-ink-700">
              <input type="checkbox" class="h-5 w-5 accent-[#0c831f]" t-att-checked="r.required" t-on-change="(ev) => onRequired(ev, r_index)"/>
              Required
            </label>
            <!-- Big, labelled and red: removing a requirement should be easy to find and hard to miss on a phone. -->
            <button type="button" t-att-class="removeClass" t-att-aria-label="'Remove ' + (r.label or 'this proof')"
              t-on-click="() => props.onRemove(r_index)">
              <Icon name="'trash'" size="18"/> Remove
            </button>
          </div>
        </div>
      </div>
      <button type="button" t-att-class="addClass" t-on-click="props.onAdd">
        <Icon name="'plus'" size="16"/> Add proof requirement
      </button>
    </div>`;
  static components = { Icon };
  static override props = {
    requirements: Array,
    onUpdate: Function,
    onRemove: Function,
    onAdd: Function,
  };

  typeOptions = Object.entries(PROOF_TYPE_LABELS).map(([value, label]) => ({ value, label }));
  selectClass = input(false, 'w-auto min-h-[44px] px-2 text-sm');
  labelClass = input(false, 'w-full');
  // `!` because the secondary variant's own text and border colours would
  // otherwise win: two colour utilities resolve by stylesheet order.
  removeClass = btn('secondary', 'default', 'ml-auto !border-dispute/40 !text-dispute hover:!border-dispute hover:!bg-dispute/5');
  addClass = btn('secondary', 'sm', 'self-start');

  // Arrow properties: OWL calls methods from inline template arrows without `this`.
  onType = (ev: Event, index: number) => {
    this.props.onUpdate(index, { type: (ev.target as HTMLSelectElement).value as ProofType });
  };

  onLabel = (ev: Event, index: number) => {
    this.props.onUpdate(index, { label: (ev.target as HTMLInputElement).value });
  };

  onRequired = (ev: Event, index: number) => {
    this.props.onUpdate(index, { required: (ev.target as HTMLInputElement).checked });
  };

  /** Typed view of the rows, for callers that need it. */
  get rows(): ProofRequirement[] {
    return this.props.requirements as ProofRequirement[];
  }
}
