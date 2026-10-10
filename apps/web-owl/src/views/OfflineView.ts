import { Component, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';

/**
 * Reachable at /offline. The service worker's real fallback is the static
 * /offline.html (it must render with nothing but what was cached at install
 * time); this route keeps the same screen available inside the app.
 */
export class OfflineView extends Component {
  static override template = xml`
    <div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper-50 px-6 text-center">
      <Icon name="'wifi-off'" size="40" class="'text-ink-300'"/>
      <div>
        <h1 class="text-lg font-medium text-ink-900">You’re offline</h1>
        <p class="mt-1 max-w-xs text-sm text-ink-500">
          OnSite needs a connection for live task data. Reconnect and reload to continue.
        </p>
      </div>
    </div>`;
  static components = { Icon };
  static override props = {};
}
