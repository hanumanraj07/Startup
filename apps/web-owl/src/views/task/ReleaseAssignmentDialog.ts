import { Component, useState, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { ApiError, api } from '@/services/api';
import { btn, input, LABEL } from '@/ui/classes';

type Mode = 'leave' | 'remove';

const REASONS: Record<Mode, { value: string; label: string }[]> = {
  leave: [
    { value: 'CANT_REACH_LOCATION', label: 'I can’t get to the location' },
    { value: 'PERSONAL_EMERGENCY', label: 'Personal emergency' },
    { value: 'TASK_NOT_AS_DESCRIBED', label: 'The task isn’t what was described' },
    { value: 'SAFETY_CONCERN', label: 'I don’t feel safe doing it' },
    { value: 'OTHER', label: 'Something else' },
  ],
  remove: [
    { value: 'NOT_RESPONDING', label: 'The worker isn’t responding' },
    { value: 'TOO_SLOW', label: 'They’re taking too long to get there' },
    { value: 'SAFETY_CONCERN', label: 'I have a safety concern' },
    { value: 'OTHER', label: 'Something else' },
  ],
};

/**
 * Releasing an assignment, from either side: a worker leaving a task they
 * accepted, or a requester removing the worker before arrival. Both send the
 * task back to matching; the API decides whether it is still allowed.
 */
export class ReleaseAssignmentDialog extends Component {
  static override template = xml`
    <div>
      <button type="button" t-att-class="triggerClass" t-on-click="openDialog">
        <Icon name="isLeave ? 'log-out' : 'user'" size="16"/> <t t-out="isLeave ? 'Leave this task' : 'Remove worker'"/>
      </button>
      <Modal open="state.open" onClose="closeDialog" title="title" description="description">
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5">
            <label for="release-reason" class="${LABEL}">Why?</label>
            <select id="release-reason" t-att-class="selectClass" t-model="state.reason">
              <option t-foreach="reasons" t-as="r" t-key="r.value" t-att-value="r.value" t-out="r.label"/>
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="release-note" class="${LABEL}">
              Anything to add? <span t-if="state.reason !== 'OTHER'" class="font-normal text-ink-400">(optional)</span>
            </label>
            <textarea id="release-note" t-att-class="textareaClass" rows="3" maxlength="500" t-model="state.note"/>
          </div>
          <p t-if="isLeave" class="rounded-input bg-tint-orange p-3 text-sm text-[#7a3d00]">
            Leaving lowers your completion rate, which affects which tasks you’re offered. Any proof you’ve uploaded is discarded,
            and you won’t be able to accept this task again.
          </p>
          <p t-else="" class="rounded-input bg-paper-100 p-3 text-sm text-ink-700">
            The task goes back to other nearby workers and your payment stays held. <t t-out="props.workerName or 'The worker'"/>
            is told they don’t need to come.
          </p>
          <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
        </div>
        <t t-set-slot="footer">
          <button type="button" t-att-class="cancelClass" t-on-click="closeDialog">Keep <t t-out="isLeave ? 'the task' : 'this worker'"/></button>
          <button type="button" t-att-class="confirmClass" t-att-disabled="state.submitting or !valid" t-on-click="submit">
            <t t-out="isLeave ? 'Leave task' : 'Remove worker'"/>
          </button>
        </t>
      </Modal>
    </div>`;
  static components = { Icon, Modal };
  static override props = {
    taskId: String,
    mode: String,
    workerName: { type: String, optional: true },
    onDone: Function,
  };

  state = useState({ open: false, reason: '', note: '', submitting: false, error: null as string | null });

  triggerClass = btn('ghost', 'sm', 'text-dispute hover:bg-dispute/10');
  selectClass = input();
  textareaClass = input(false, 'min-h-[72px] py-2');
  cancelClass = btn('secondary');
  confirmClass = btn('destructive');

  override setup() {
    this.state.reason = this.reasons[0]?.value ?? 'OTHER';
  }

  get isLeave(): boolean {
    return this.props.mode === 'leave';
  }

  get reasons() {
    return REASONS[this.props.mode as Mode];
  }

  get title(): string {
    return this.isLeave ? 'Leave this task?' : `Remove ${this.props.workerName ?? 'this worker'}?`;
  }

  get description(): string {
    return this.isLeave
      ? 'The task goes back to other workers nearby.'
      : 'You can do this until the worker arrives. After that, use Report an issue instead.';
  }

  get valid(): boolean {
    return this.state.reason !== 'OTHER' || this.state.note.trim().length >= 5;
  }

  openDialog() {
    this.state.error = null;
    this.state.open = true;
  }

  closeDialog = () => {
    this.state.open = false;
  };

  async submit() {
    const { state } = this;
    state.submitting = true;
    state.error = null;
    try {
      const path = this.isLeave ? 'leave' : 'remove-worker';
      const note = state.note.trim();
      await api.post(`/tasks/${this.props.taskId}/${path}`, { reason: state.reason, ...(note && { note }) });
      state.open = false;
      this.props.onDone();
    } catch (err) {
      state.error = err instanceof ApiError ? err.message : 'That didn’t work. Try again.';
    } finally {
      state.submitting = false;
    }
  }
}
