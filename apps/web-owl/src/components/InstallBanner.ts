import { Component, useExternalListener, useState, xml } from '@odoo/owl';
import type { BeforeInstallPromptEvent } from '@/services/pwa';
import { btn } from '@/ui/classes';
import { Icon } from './Icon';

/**
 * Shown only when the browser has actually decided the app is installable
 * (`beforeinstallprompt`), never a generic "add to home screen" claim, since
 * whether that is even possible varies by browser and platform.
 */
export class InstallBanner extends Component {
  static override template = xml`
    <div t-if="state.event and !state.dismissed" class="flex items-center justify-between gap-3 border-b border-line bg-paper-100 px-4 py-2.5 text-sm">
      <span class="flex items-center gap-2 text-ink-900">
        <Icon name="'download'" size="16" class="'text-brand-700'"/>
        Install OnSite for quicker access and offline support.
      </span>
      <div class="flex items-center gap-2">
        <button type="button" t-att-class="installClass" t-on-click="install">Install</button>
        <button type="button" aria-label="Dismiss" t-att-class="dismissClass" t-on-click="dismiss">
          <Icon name="'x'" size="16"/>
        </button>
      </div>
    </div>`;
  static components = { Icon };
  static override props = {};

  state = useState<{ event: BeforeInstallPromptEvent | null; dismissed: boolean }>({ event: null, dismissed: false });
  installClass = btn('primary', 'sm');
  dismissClass = 'rounded-full p-1 text-ink-400 hover:bg-paper-0 hover:text-ink-700';

  override setup() {
    useExternalListener(window, 'beforeinstallprompt', (event: Event) => {
      event.preventDefault();
      this.state.event = event as BeforeInstallPromptEvent;
    });
  }

  install = async () => {
    const event = this.state.event;
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    this.state.event = null;
  };

  dismiss = () => {
    this.state.dismissed = true;
  };
}
