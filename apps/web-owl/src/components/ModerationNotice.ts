import { Component, onWillUnmount, useState, xml } from '@odoo/owl';
import { ApiError, api } from '@/services/api';
import { btn } from '@/ui/classes';
import { Icon } from './Icon';
import { TextAreaField } from './TextAreaField';

export interface ModerationNoticeData {
  /** blocked: this content was refused. restricted: posting is paused by an earlier block. */
  kind: 'blocked' | 'restricted';
  message: string;
  eventId?: string;
  restrictedUntil?: string;
}

/**
 * The strict warning shown when a task is refused by moderation, or while the
 * posting cooldown that follows is running. Deliberately calm and plain (it
 * sits on the money/safety tier): no animation, high contrast, a live
 * countdown, and a way to ask a human to look again. The cooldown itself is
 * enforced by the API; this only explains it.
 */
export class ModerationNotice extends Component {
  static override template = xml`
    <section role="alert" class="rounded-card border-2 border-dispute/30 bg-dispute/10 p-5">
      <div class="flex gap-3">
        <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-dispute text-white" aria-hidden="true">
          <Icon name="'shield-alert'" size="18"/>
        </span>
        <div class="flex min-w-0 flex-col gap-1">
          <h2 class="font-bold text-[#7a1b14]" t-out="heading"/>
          <p class="text-sm text-[#7a1b14]" t-out="props.notice.message"/>
          <p t-if="state.remaining > 0" class="tabular text-sm font-semibold text-[#7a1b14]">
            You can post again in <t t-out="countdown"/>
          </p>
          <p t-elif="props.notice.restrictedUntil" class="text-sm font-semibold text-[#7a1b14]">
            The pause is over. Edit the task so it follows the rules, then try again.
          </p>
        </div>
      </div>
      <p class="mt-3 text-xs text-[#7a1b14]">
        OnSite sends real people to real places. Tasks involving violence, threats, illegal activity, stalking or harassment
        are never allowed, and repeated attempts are reviewed by our safety team.
      </p>

      <div t-if="props.notice.eventId" class="mt-4 border-t border-dispute/20 pt-4">
        <p t-if="state.appeal === 'sent'" class="text-sm font-medium text-ink-900">
          Review requested. A person will look at it and we will notify you of the outcome.
        </p>
        <button t-elif="!state.open" type="button" t-att-class="mistakeClass" t-on-click="openAppeal">
          I think this is a mistake
        </button>
        <div t-else="" class="flex flex-col gap-3">
          <TextAreaField id="'moderation-appeal'" label="'What is this task really for?'" value="state.note"
            onInput="setNote" rows="3" maxlength="1000" error="state.error or undefined"
            hint="'A person will read this. Explain what the worker would actually do.'"/>
          <div class="flex flex-wrap gap-2">
            <button type="button" t-att-class="sendClass" t-att-disabled="state.appeal === 'sending'" t-on-click="sendAppeal">
              Request a human review
            </button>
            <button type="button" t-att-class="cancelClass" t-on-click="closeAppeal">Cancel</button>
          </div>
        </div>
      </div>
    </section>`;
  static components = { Icon, TextAreaField };
  static override props = {
    notice: Object,
    onExpired: { type: Function, optional: true },
  };

  state = useState({ remaining: 0, open: false, note: '', appeal: 'idle' as 'idle' | 'sending' | 'sent', error: '' });
  mistakeClass = btn('secondary', 'sm');
  sendClass = btn('dark', 'sm');
  cancelClass = btn('ghost', 'sm');
  private timer: ReturnType<typeof setInterval> | null = null;

  override setup() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
    onWillUnmount(() => {
      if (this.timer) clearInterval(this.timer);
    });
  }

  get heading(): string {
    return this.props.notice.kind === 'blocked' ? "This task can't be posted" : 'Posting is paused';
  }

  get countdown(): string {
    const m = Math.floor(this.state.remaining / 60);
    const s = this.state.remaining % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  private tick() {
    const until = this.props.notice.restrictedUntil ? Date.parse(this.props.notice.restrictedUntil) : NaN;
    const remaining = Number.isFinite(until) ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
    const wasRunning = this.state.remaining > 0;
    this.state.remaining = remaining;
    if (wasRunning && remaining === 0) this.props.onExpired?.();
  }

  openAppeal = () => {
    this.state.open = true;
  };

  closeAppeal = () => {
    this.state.open = false;
    this.state.error = '';
  };

  setNote = (value: string) => {
    this.state.note = value;
  };

  sendAppeal = async () => {
    const note = this.state.note.trim();
    if (note.length < 10) {
      this.state.error = 'Explain briefly why this task is legitimate (at least 10 characters).';
      return;
    }
    this.state.appeal = 'sending';
    this.state.error = '';
    try {
      await api.post(`/moderation/events/${this.props.notice.eventId}/appeal`, { note });
      this.state.appeal = 'sent';
    } catch (err) {
      this.state.appeal = 'idle';
      this.state.error = err instanceof ApiError ? err.message : 'Could not send the request. Try again.';
    }
  };
}

/** Builds the notice from a TASK_BLOCKED or POSTING_RESTRICTED API error; null for anything else. */
export function moderationNoticeFrom(error: unknown): ModerationNoticeData | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code !== 'TASK_BLOCKED' && error.code !== 'POSTING_RESTRICTED') return null;
  const details = error.details ?? {};
  return {
    kind: error.code === 'TASK_BLOCKED' ? 'blocked' : 'restricted',
    message: error.message,
    eventId: typeof details.eventId === 'string' ? details.eventId : undefined,
    restrictedUntil: typeof details.restrictedUntil === 'string' ? details.restrictedUntil : undefined,
  };
}
