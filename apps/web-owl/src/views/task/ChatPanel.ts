import { Component, onMounted, onPatched, useRef, useState, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { useTaskSocket } from '@/hooks/use-task-socket';
import type { ChatMessage } from '@/lib/api-types';
import { formatTime } from '@/lib/format';
import { api } from '@/services/api';
import { store } from '@/store/store';
import { btn, card, CARD_HEADER, CARD_TITLE, input } from '@/ui/classes';

/** The task's conversation, styled like an Odoo chatter: bubbles, a redaction note, and a composer. */
export class ChatPanel extends Component {
  static override template = xml`
    <div t-att-class="cardClass">
      <div class="${CARD_HEADER}">
        <h2 class="${CARD_TITLE}">Messages</h2>
      </div>
      <div class="flex flex-col gap-3 p-6 pt-3">
        <div t-ref="scroller" class="flex max-h-80 flex-col gap-2 overflow-y-auto py-2" aria-live="polite">
          <p t-if="!state.messages" class="text-sm text-ink-400">Loading…</p>
          <p t-elif="state.messages.length === 0" class="text-sm text-ink-400">
            No messages yet. Phone numbers, emails and UPI IDs are redacted automatically.
          </p>
          <t t-else="">
            <div t-foreach="state.messages" t-as="m" t-key="m.id" t-att-class="rowClass(m)">
              <div t-att-class="bubbleClass(m)" t-out="m.body"/>
              <span t-if="m.redactionFlags.length > 0" class="mt-0.5 text-xs text-[#856404]">Contact info removed</span>
              <span class="mt-0.5 text-xs text-ink-400" t-out="time(m)"/>
            </div>
          </t>
        </div>

        <p t-if="props.closed" class="rounded-card bg-paper-100 px-3 py-2 text-sm text-ink-500">
          Chat is closed now that this task is finished. Use “Report an issue” if you need to raise something.
        </p>
        <form t-else="" class="flex gap-2" t-on-submit.prevent="send">
          <input
            t-att-class="inputClass"
            t-model="state.draft"
            placeholder="Write a message…"
            aria-label="Message"
            maxlength="2000"
          />
          <button type="submit" t-att-class="sendClass" t-att-disabled="cannotSend" aria-label="Send">
            <Icon name="'send'" size="16"/>
          </button>
        </form>
      </div>
    </div>`;
  static components = { Icon };
  static override props = {
    taskId: String,
    closed: Boolean,
  };

  store = useState(store);
  state = useState<{ messages: ChatMessage[] | null; draft: string; sending: boolean }>({
    messages: null,
    draft: '',
    sending: false,
  });
  scroller = useRef('scroller');

  cardClass = card();
  inputClass = input();
  sendClass = btn('primary', 'icon');

  private shownCount = 0;

  override setup() {
    onMounted(() => {
      void this.loadHistory();
      api.post(`/tasks/${this.props.taskId}/messages/read`).catch(() => undefined);
    });

    // `isMine` on the broadcast payload is computed once, from the SENDER's
    // perspective, then fanned out identically to the whole room (see
    // realtime.gateway.ts's emitNewMessage). Trusting it would show the other
    // party's message as "mine" on their own screen, so it is recomputed from
    // the actually-logged-in user.
    useTaskSocket(this.props.taskId, {
      onMessage: (raw) => {
        const message = raw as ChatMessage;
        const corrected = { ...message, isMine: message.senderId === this.store.user?.id };
        const current = this.state.messages ?? [];
        if (current.some((m) => m.id === corrected.id)) return;
        this.state.messages = [...current, corrected];
      },
    });

    onPatched(() => {
      const count = this.state.messages?.length ?? 0;
      if (count !== this.shownCount) {
        this.shownCount = count;
        const el = this.scroller.el;
        if (el) el.scrollTop = el.scrollHeight;
      }
    });
  }

  get cannotSend(): boolean {
    return this.state.sending || !this.state.draft.trim();
  }

  rowClass(m: ChatMessage): string {
    return `flex flex-col ${m.isMine ? 'items-end' : 'items-start'}`;
  }

  bubbleClass(m: ChatMessage): string {
    const tone = m.isMine ? 'bg-brand-solid text-ink-900' : 'bg-paper-100 text-ink-900';
    return `max-w-[75%] rounded-card px-3 py-2 text-sm ${tone}`;
  }

  time(m: ChatMessage): string {
    return formatTime(m.createdAt);
  }

  private async loadHistory() {
    const { data } = await api.get<{ data: ChatMessage[] }>(`/tasks/${this.props.taskId}/messages?limit=50`);
    this.state.messages = [...data].reverse();
  }

  async send() {
    const body = this.state.draft.trim();
    if (!body) return;
    this.state.sending = true;
    this.state.draft = '';
    try {
      // The server broadcasts our own message back over the socket, so it is
      // not appended here too: doing both would duplicate every message.
      await api.post(`/tasks/${this.props.taskId}/messages`, { body });
    } finally {
      this.state.sending = false;
    }
  }
}
