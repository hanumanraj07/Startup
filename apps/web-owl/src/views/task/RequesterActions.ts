import { Component, useState, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { ProofTile } from '@/components/ProofTile';
import type { ProofView } from '@/lib/api-types';
import { ApiError, api } from '@/services/api';
import { btn, card, CARD_CONTENT, CARD_HEADER, CARD_TITLE, input } from '@/ui/classes';

const MIN_REASON = 10;

/** The requester's review: look at the evidence, then approve (releasing payment) or send it back for rework. */
export class RequesterActions extends Component {
  static override template = xml`
    <div t-if="reviewing" t-att-class="cardClass">
      <div class="${CARD_HEADER}"><h2 class="${CARD_TITLE}">Review the evidence</h2></div>
      <div class="${CARD_CONTENT} flex flex-col gap-4">
        <p t-if="proofs.length === 0" class="text-sm text-ink-500">No evidence submitted yet.</p>
        <div t-else="" class="grid gap-3 sm:grid-cols-2">
          <ProofTile t-foreach="proofs" t-as="proof" t-key="proof.id" proof="proof"/>
        </div>

        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>

        <div t-if="state.rejecting" class="flex flex-col gap-2">
          <textarea
            t-att-class="textareaClass" rows="3" t-model="state.reason"
            aria-label="Reason for sending back"
            placeholder="What’s missing or wrong? The worker will see this and can resubmit."/>
          <div class="flex gap-2">
            <button type="button" t-att-class="destructiveClass" t-att-disabled="state.busy or !reasonValid" t-on-click="reject">
              Send back for rework
            </button>
            <button type="button" t-att-class="ghostClass" t-on-click="cancelReject">Cancel</button>
          </div>
        </div>
        <div t-else="" class="flex flex-wrap gap-2">
          <button type="button" t-att-class="primaryClass" t-att-disabled="state.busy" t-on-click="approve">
            <Icon name="'check'" size="16"/> Approve and release payment
          </button>
          <button type="button" t-att-class="secondaryClass" t-on-click="startReject">
            <Icon name="'x'" size="16"/> Reject
          </button>
        </div>
      </div>
    </div>`;
  static components = { Icon, ProofTile };
  static override props = {
    taskId: String,
    status: String,
    proofs: Array,
    onChanged: Function,
  };

  state = useState<{ rejecting: boolean; reason: string; busy: boolean; error: string | null }>({
    rejecting: false,
    reason: '',
    busy: false,
    error: null,
  });

  cardClass = card();
  textareaClass = input(false, 'min-h-[80px] py-2');
  primaryClass = btn('primary');
  secondaryClass = btn('secondary');
  destructiveClass = btn('destructive');
  ghostClass = btn('ghost');

  get reviewing(): boolean {
    return this.props.status === 'SUBMITTED' || this.props.status === 'UNDER_REVIEW';
  }

  get proofs(): ProofView[] {
    return this.props.proofs as ProofView[];
  }

  get reasonValid(): boolean {
    return this.state.reason.trim().length >= MIN_REASON;
  }

  startReject() {
    this.state.rejecting = true;
  }

  cancelReject() {
    this.state.rejecting = false;
  }

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

  approve() {
    return this.run(() => api.post(`/tasks/${this.props.taskId}/approve`));
  }

  reject() {
    return this.run(() => api.post(`/tasks/${this.props.taskId}/reject`, { reason: this.state.reason.trim() }));
  }
}
