import { Component, useState, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { ApiError, api } from '@/services/api';
import { btn, input, LABEL } from '@/ui/classes';

const DEFAULT_REASON = 'WORK_NOT_DONE';
const MIN_DESCRIPTION = 20;

const REASONS: { value: string; label: string }[] = [
  { value: 'WORK_NOT_DONE', label: 'The work was not actually done' },
  { value: 'EVIDENCE_INSUFFICIENT', label: 'The proof provided is not enough' },
  { value: 'INSTRUCTIONS_NOT_FOLLOWED', label: 'Instructions were not followed' },
  { value: 'EVIDENCE_FALSIFIED', label: 'The proof looks faked or misleading' },
  { value: 'UNFAIR_REJECTION', label: 'My submission was unfairly rejected' },
  { value: 'REQUESTER_UNRESPONSIVE', label: 'The requester is not responding' },
  { value: 'OTHER', label: 'Something else' },
];

/**
 * The only channel left for anything task-related once chat closes: raising a
 * dispute puts it in front of an admin (docs/14-dispute-resolution.md) rather
 * than leaving it to an unmonitored back-and-forth where real money is at stake.
 */
export class ReportIssueDialog extends Component {
  static override template = xml`
    <div>
      <button type="button" t-att-class="triggerClass" t-on-click="openDialog">
        <Icon name="'flag'" size="16"/> Report an issue
      </button>
      <Modal open="state.open" onClose="closeDialog" title="'Report an issue with this task'"
        description="'This is reviewed by an admin, not the other party. The task is frozen while it’s reviewed.'">
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5">
            <label for="report-reason" class="${LABEL}">What went wrong?</label>
            <select id="report-reason" t-att-class="selectClass" t-model="state.reason">
              <option t-foreach="reasons" t-as="r" t-key="r.value" t-att-value="r.value" t-out="r.label"/>
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="report-description" class="${LABEL}">Explain what happened</label>
            <textarea id="report-description" t-att-class="textareaClass" rows="4" maxlength="5000"
              aria-describedby="report-description-hint" t-model="state.description"/>
            <p id="report-description-hint" class="text-sm text-ink-400">At least 20 characters.</p>
          </div>
          <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
        </div>
        <t t-set-slot="footer">
          <button type="button" t-att-class="cancelClass" t-on-click="closeDialog">Cancel</button>
          <button type="button" t-att-class="submitClass" t-att-disabled="state.submitting or !descriptionValid" t-on-click="submit">
            Submit report
          </button>
        </t>
      </Modal>
    </div>`;
  static components = { Icon, Modal };
  static override props = {
    taskId: String,
    onReported: Function,
  };

  state = useState({ open: false, reason: DEFAULT_REASON, description: '', submitting: false, error: null as string | null });

  reasons = REASONS;
  triggerClass = btn('secondary', 'sm');
  selectClass = input();
  textareaClass = input(false, 'min-h-[96px] py-2');
  cancelClass = btn('secondary');
  submitClass = btn('primary');

  get descriptionValid(): boolean {
    return this.state.description.trim().length >= MIN_DESCRIPTION;
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
      await api.post(`/tasks/${this.props.taskId}/dispute`, { reason: state.reason, description: state.description.trim() });
      state.open = false;
      state.description = '';
      this.props.onReported();
    } catch (err) {
      state.error = err instanceof ApiError ? err.message : 'Could not submit your report.';
    } finally {
      state.submitting = false;
    }
  }
}
