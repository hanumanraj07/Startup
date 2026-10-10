import { Component, useState, xml } from '@odoo/owl';
import { dismissToast, store, type Toast } from '@/store/store';

export class Toaster extends Component {
  static override template = xml`
    <div class="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6">
      <div
        t-foreach="store.toasts"
        t-as="item"
        t-key="item.id"
        role="status"
        t-att-class="toastClass(item)"
      >
        <div class="flex-1">
          <p class="text-sm font-semibold text-ink-900" t-out="item.title"/>
          <p t-if="item.description" class="text-sm text-ink-500" t-out="item.description"/>
        </div>
        <button type="button" class="text-ink-400 hover:text-ink-900" aria-label="Dismiss" t-on-click="() => dismiss(item.id)">×</button>
      </div>
    </div>`;
  static override props = {};

  store = useState(store);

  toastClass(item: Toast): string {
    const tone =
      item.variant === 'error' ? 'border-dispute' : item.variant === 'success' ? 'border-verified' : 'border-line';
    return `pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border bg-paper-0 p-4 shadow-float ${tone}`;
  }

  dismiss(id: number) {
    dismissToast(id);
  }
}
