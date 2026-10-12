import { Component, xml } from '@odoo/owl';
import { StatusPill } from '@/components/StatusPill';
import { btn, card } from '@/ui/classes';

/**
 * A static preview of the worker feed's task card (docs/19-ui-design-system.md),
 * built from the founding example. Distance and payout are what a worker reads
 * first, so they lead visually.
 */
export class TaskCardPreview extends Component {
  static override template = xml`
    <div t-att-class="cardClass">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-400">Product inspection</p>
          <!-- Not a real heading: a static mockup of a feed card, not a named section of the page. -->
          <p class="mt-1 text-lg font-bold leading-snug text-ink-900">Inspect MacBook Air M4 at XYZ Computer Store</p>
        </div>
        <StatusPill status="'PUBLISHED'"/>
      </div>

      <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div><dt class="text-ink-400">Distance</dt><dd class="tabular font-semibold text-ink-900">2.1 km</dd></div>
        <div><dt class="text-ink-400">You receive</dt><dd class="tabular font-semibold text-verified">₹425</dd></div>
        <div><dt class="text-ink-400">Deadline</dt><dd class="tabular text-ink-700">Today, 6:00 PM</dd></div>
        <div><dt class="text-ink-400">Requester</dt><dd class="tabular text-ink-700">4.8 ★ · 12 tasks</dd></div>
      </dl>

      <button type="button" t-att-class="buttonClass" tabindex="-1" aria-hidden="true">View task</button>
    </div>`;
  static components = { StatusPill };
  static override props = {};

  cardClass = card('w-full p-5');
  buttonClass = btn('primary', 'default', 'mt-5 w-full');
}
