import { Component, onMounted, useState, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { currentPushSubscription, pushSupported, subscribeToPush } from '@/services/push';
import { btn, card } from '@/ui/classes';

/** Opt-in to Web Push on this device. Renders nothing where the browser can't do push. */
export class NotificationsCard extends Component {
  static override template = xml`
    <div t-if="state.supported" t-att-class="cardClass">
      <div class="flex items-center justify-between gap-3">
        <span class="flex items-center gap-2 text-sm text-ink-700">
          <Icon name="'bell'" size="16" class="'text-ink-400'"/>
          <t t-if="state.subscribed">Push notifications are on for this device.</t>
          <t t-else="">Get notified when something needs your attention.</t>
        </span>
        <button t-if="!state.subscribed" type="button" t-att-class="buttonClass" t-att-disabled="state.busy" t-on-click="enable">
          Enable notifications
        </button>
      </div>
      <p t-if="state.error" role="alert" class="mt-3 text-sm text-dispute" t-out="state.error"/>
    </div>`;
  static components = { Icon };
  static override props = {};

  state = useState<{ supported: boolean; subscribed: boolean; busy: boolean; error: string | null }>({
    supported: false,
    subscribed: false,
    busy: false,
    error: null,
  });

  cardClass = card('p-4');
  buttonClass = btn('secondary', 'sm');

  override setup() {
    onMounted(() => {
      this.state.supported = pushSupported();
      void currentPushSubscription().then((subscription) => {
        this.state.subscribed = subscription !== null;
      });
    });
  }

  async enable() {
    const { state } = this;
    state.busy = true;
    state.error = null;
    try {
      const ok = await subscribeToPush();
      if (ok) state.subscribed = true;
      else state.error = 'Notification permission was not granted.';
    } catch {
      state.error = 'Could not enable notifications on this device.';
    } finally {
      state.busy = false;
    }
  }
}
