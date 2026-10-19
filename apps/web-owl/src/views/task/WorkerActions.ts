import { Component, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import type { TaskStatus } from '@onsite/types';
import { Icon } from '@/components/Icon';
import { ProofChecklist } from '@/components/ProofChecklist';
import { TextField } from '@/components/TextField';
import { parseBudgetPaise } from '@/lib/wizard';
import type { ProofRequirement, ProofView } from '@/lib/api-types';
import { ApiError, api } from '@/services/api';
import { getPosition } from '@/services/geo';
import { btn, card, CARD_CONTENT, CARD_HEADER, CARD_TITLE } from '@/ui/classes';
import { RequirementCapture } from './RequirementCapture';

type Stage = 'assigned' | 'en-route' | 'collect' | 'submitted' | null;

/** The assigned worker's controls, one stage per task status: en route, arrive, collect proof, submit. */
export class WorkerActions extends Component {
  static override template = xml`
    <div t-if="stage === 'assigned'" t-att-class="cardClass">
      <div class="${CARD_CONTENT} flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-ink-500">
          Tap when you set off<t t-if="isDelivery"> for the pickup</t>. Your live location is shared with the requester from then until you arrive.
        </p>
        <button type="button" t-att-class="primaryClass" t-att-disabled="state.busy" t-on-click="markEnRoute">
          <Icon name="'navigation'" size="16"/> On my way
        </button>
      </div>
      <p t-if="props.item" class="mx-6 mb-6 flex items-start gap-2 rounded-input bg-tint-orange px-3 py-2 text-sm text-[#7a3d00]">
        <Icon name="'wallet'" size="16"/>
        <span>Carry up to <strong class="tabular" t-out="itemBudget"/> for the item. You pay at the shop, keep the receipt, and get it back with your earnings.</span>
      </p>
      <p t-if="state.error" role="alert" class="px-6 pb-6 text-sm text-dispute" t-out="state.error"/>
    </div>

    <div t-elif="stage === 'en-route'" t-att-class="cardClass">
      <div class="${CARD_CONTENT} flex flex-col gap-3">
        <p class="text-sm text-ink-500">
          When you’re at <t t-out="isDelivery ? 'the pickup' : 'the location'"/>, confirm arrival. Your GPS position is measured
          against the exact address — the app never asks you to type a distance.
        </p>
        <button type="button" t-att-class="primaryClass + ' self-start'" t-att-disabled="state.busy" t-on-click="confirmArrival">
          <Icon name="'map-pin'" size="16"/> <t t-out="isDelivery ? 'I’m at the pickup' : 'I’m here'"/>
        </button>
        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
      </div>
    </div>

    <div t-elif="stage === 'collect'" t-att-class="cardClass">
      <div class="${CARD_HEADER}"><h2 class="${CARD_TITLE}" t-out="collectTitle"/></div>
      <div class="${CARD_CONTENT} flex flex-col gap-4">
        <p t-if="collectHint" class="rounded-input bg-brand-50 px-3 py-2 text-sm text-ink-900" t-out="collectHint"/>
        <ProofChecklist requirements="requirements" proofs="proofs"/>

        <div class="flex flex-col gap-3 border-t border-line pt-4">
          <t t-foreach="outstanding" t-as="req" t-key="req_index">
            <RequirementCapture taskId="props.taskId" requirement="req" disabled="state.busy"
              onCapture="capture" onError="setError"/>
          </t>
        </div>

        <TextField t-if="props.item and status === 'IN_PROGRESS'" id="'item-cost'" label="'What did the item cost? (₹)'"
          type="'number'" min="'0'" max="itemMaxRupees" hint="itemCostHint" error="itemCostError"
          value="state.itemCost" onInput="setItemCost"/>

        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>

        <button type="button" t-att-class="submitClass" t-att-disabled="state.busy or !allMet or !itemCostReady" t-on-click="submit">
          <Icon name="'send'" size="16"/> <t t-out="isDelivery ? 'Delivered: submit proof' : 'Submit for review'"/>
        </button>
      </div>
    </div>

    <div t-elif="stage === 'submitted'" t-att-class="cardClass">
      <div class="${CARD_CONTENT} text-sm text-ink-500">
        Submitted. The requester has up to 24 hours to review before it auto-approves.
      </div>
    </div>`;
  static components = { Icon, ProofChecklist, RequirementCapture, TextField };
  static override props = {
    taskId: String,
    status: String,
    proofRequirements: Array,
    proofs: Array,
    onChanged: Function,
    /** SINGLE or PICKUP_DROPOFF: deliveries get their own wording for each leg. */
    locationMode: { type: String, optional: true },
    /** An item to buy and be reimbursed for. Undefined when nothing is bought. */
    item: { type: Object, optional: true },
  };

  state = useState<{ busy: boolean; error: string | null; itemCost: string }>({ busy: false, error: null, itemCost: '' });

  cardClass = card();
  primaryClass = btn('primary');
  submitClass = btn('primary', 'default', 'w-full');

  get stage(): Stage {
    const status = this.props.status as TaskStatus;
    if (status === 'ASSIGNED') return 'assigned';
    if (status === 'WORKER_EN_ROUTE') return 'en-route';
    if (status === 'ARRIVED' || status === 'IN_PROGRESS') return 'collect';
    if (status === 'SUBMITTED' || status === 'UNDER_REVIEW') return 'submitted';
    return null;
  }

  get status(): TaskStatus {
    return this.props.status as TaskStatus;
  }

  get itemBudget(): string {
    return this.props.item ? formatPaise(this.props.item.budgetPaise) : '';
  }

  get itemMaxRupees(): string {
    return this.props.item ? String(this.props.item.budgetPaise / 100) : '0';
  }

  get itemCostHint(): string {
    return `Exactly as on the receipt, at most ${this.itemBudget}. This is what you are paid back.`;
  }

  private get itemCostPaise(): number | null {
    return parseBudgetPaise(this.state.itemCost.trim());
  }

  get itemCostError(): string | undefined {
    const cost = this.itemCostPaise;
    if (!this.props.item || cost === null) return undefined;
    return cost > this.props.item.budgetPaise ? `More than the ${this.itemBudget} set aside. Ask the requester in chat first.` : undefined;
  }

  /** No item, or a cost entered within the budget. Zero is allowed: the item may have been unavailable. */
  get itemCostReady(): boolean {
    if (!this.props.item) return true;
    const cost = this.itemCostPaise;
    return cost !== null && cost <= this.props.item.budgetPaise;
  }

  setItemCost = (value: string) => {
    this.state.itemCost = value;
  };

  get isDelivery(): boolean {
    return this.props.locationMode === 'PICKUP_DROPOFF';
  }

  get collectTitle(): string {
    if (!this.isDelivery) return 'Collect proof';
    return this.props.status === 'ARRIVED' ? 'Collect the item' : 'Hand it over';
  }

  /** For a delivery, the first photo at the pickup is what marks it collected (and starts sharing the drop-off leg). */
  get collectHint(): string {
    if (!this.isDelivery) return '';
    return this.props.status === 'ARRIVED'
      ? 'Photograph the item at the pickup to confirm you have it. Then head to the drop-off; your live location is shared again on the way.'
      : 'At the drop-off, photograph the handover and note who received it, then submit.';
  }

  get requirements(): ProofRequirement[] {
    return this.props.proofRequirements as ProofRequirement[];
  }

  get proofs(): ProofView[] {
    return this.props.proofs as ProofView[];
  }

  private countFor(req: ProofRequirement): number {
    return this.proofs.filter((p) => p.type === req.type && (!req.fieldKey || p.fieldKey === req.fieldKey)).length;
  }

  /** Every required proof present, as a UI convenience; the server is the authority on submit. */
  get allMet(): boolean {
    return this.requirements.filter((r) => r.required).every((r) => this.countFor(r) >= (r.minCount ?? 1));
  }

  /** Requirements that still need capturing. */
  get outstanding(): ProofRequirement[] {
    return this.requirements.filter((r) => this.countFor(r) < (r.minCount ?? 1));
  }

  setError = (message: string) => {
    this.state.error = message;
  };

  private async run(action: () => Promise<unknown>) {
    this.state.busy = true;
    this.state.error = null;
    try {
      await action();
      await this.props.onChanged();
    } catch (err) {
      this.state.error = err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
    } finally {
      this.state.busy = false;
    }
  }

  markEnRoute() {
    return this.run(() => api.post(`/tasks/${this.props.taskId}/en-route`));
  }

  confirmArrival() {
    return this.run(async () => {
      const position = await getPosition();
      if (!position) throw new ApiError(0, 'NO_LOCATION', 'Enable location access to confirm arrival.');
      await api.post(`/tasks/${this.props.taskId}/arrive`, {
        location: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        },
      });
    });
  }

  capture = (payload: Record<string, unknown>) => this.run(() => api.post(`/tasks/${this.props.taskId}/proofs`, payload));

  submit() {
    const itemSpentPaise = this.props.item ? this.itemCostPaise : null;
    return this.run(() =>
      api.post(`/tasks/${this.props.taskId}/submit`, itemSpentPaise !== null ? { itemSpentPaise } : {}),
    );
  }
}
