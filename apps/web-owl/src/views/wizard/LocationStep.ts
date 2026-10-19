import { Component, useState, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { LocationPicker } from '@/components/LocationPicker';
import type { PickedLocation } from '@/lib/api-types';
import { composeAddress, isLocationReady } from '@/lib/wizard';
import { btn } from '@/ui/classes';

type Leg = 'pickup' | 'dropoff';

/**
 * Step 2. What it asks depends on the category: one place for inspections and
 * visits, or a pickup and a drop-off for deliveries — never both when only one
 * is needed. Deliveries get the ride-app layout: a route card with the two
 * legs, and the map picker below for whichever leg is being set.
 */
export class LocationStep extends Component {
  static override template = xml`
    <div class="flex flex-col gap-4">
      <t t-if="isDelivery">
        <div>
          <h2 class="text-xl font-bold tracking-tight text-ink-900">Pickup and drop-off</h2>
          <p class="mt-1 text-sm text-ink-500">Where the worker collects it, and where they hand it over.</p>
        </div>

        <div class="rounded-card border border-line-light bg-paper-0 p-2 shadow-card" role="group" aria-label="Route">
          <button type="button" t-att-class="legClass('pickup')" t-att-aria-pressed="local.leg === 'pickup' ? 'true' : 'false'"
            t-on-click="() => editLeg('pickup')">
            <span class="relative flex w-5 shrink-0 justify-center self-stretch" aria-hidden="true">
              <span class="mt-1.5 h-3 w-3 rounded-full bg-accent-600 ring-4 ring-tint-green"/>
              <span class="absolute bottom-[-14px] top-6 border-l-2 border-dashed border-ink-300"/>
            </span>
            <span class="min-w-0 flex-1 text-left">
              <span class="block text-xs font-semibold uppercase tracking-wide text-ink-400">Pickup</span>
              <span t-att-class="legTextClass(props.wizard.pickup)" t-out="legText(props.wizard.pickup, 'Where should the worker collect it?')"/>
            </span>
            <Icon name="'chevron-right'" size="18"/>
          </button>
          <button type="button" t-att-class="legClass('dropoff')" t-att-aria-pressed="local.leg === 'dropoff' ? 'true' : 'false'"
            t-on-click="() => editLeg('dropoff')">
            <span class="flex w-5 shrink-0 justify-center" aria-hidden="true">
              <span class="mt-1.5 h-3 w-3 rounded-[3px] bg-ink-900 ring-4 ring-paper-100"/>
            </span>
            <span class="min-w-0 flex-1 text-left">
              <span class="block text-xs font-semibold uppercase tracking-wide text-ink-400">Drop-off</span>
              <span t-att-class="legTextClass(props.wizard.dropoff)" t-out="legText(props.wizard.dropoff, 'Where should it be delivered?')"/>
            </span>
            <Icon name="'chevron-right'" size="18"/>
          </button>
        </div>

        <h3 class="text-base font-bold text-ink-900" t-out="local.leg === 'pickup' ? 'Set the pickup point' : 'Set the drop-off point'"/>
        <LocationPicker t-key="local.leg" id="'loc-' + local.leg" tone="local.leg"
          value="currentValue" initialCentre="dropoffStart" onChange="onLegChange"
          searchPlaceholder="local.leg === 'pickup' ? 'Search the shop or place to collect from' : 'Search where to deliver'"
          detailsLabel="local.leg === 'pickup' ? 'Shop name, counter or landmark' : 'Flat, floor, gate or landmark'"
          detailsHint="local.leg === 'pickup' ? 'Whatever gets a worker to the right counter.' : 'Who or where to hand it to. Contact details are shared only through in-app chat.'"/>
        <button t-if="local.leg === 'pickup' and pickupReady and !dropoffReady" type="button" t-att-class="nextLegClass" t-on-click="() => editLeg('dropoff')">
          Next: set the drop-off <Icon name="'arrow-right'" size="16"/>
        </button>
        <p class="text-xs text-ink-400">
          The exact drop-off is shown only to the worker who accepts. Others nearby see just the area and the trip distance.
        </p>
      </t>

      <t t-else="">
        <div>
          <h2 class="text-xl font-bold tracking-tight text-ink-900">Where should the worker go?</h2>
          <p class="mt-1 text-sm text-ink-500">
            Anywhere in India. Search for the place, or jump to a city, then drag the map until the pin is on the exact spot.
          </p>
        </div>
        <LocationPicker id="'loc-task'" tone="'task'" value="props.wizard.pickup or undefined" onChange="props.onPickup"/>
        <p class="text-xs text-ink-400">
          Workers browsing nearby see only the area until one of them accepts the task.
        </p>
      </t>
    </div>`;
  static components = { Icon, LocationPicker };
  static override props = {
    wizard: Object,
    /** SINGLE or PICKUP_DROPOFF, from the chosen category. */
    mode: String,
    onPickup: Function,
    onDropoff: Function,
  };

  local = useState<{ leg: Leg }>({ leg: 'pickup' });
  nextLegClass = btn('dark', 'default', 'self-start');

  override setup() {
    // Coming back to this step with the pickup already set: carry on with the drop-off.
    if (this.isDelivery && isLocationReady(this.props.wizard.pickup) && !isLocationReady(this.props.wizard.dropoff)) {
      this.local.leg = 'dropoff';
    }
  }

  get isDelivery(): boolean {
    return this.props.mode === 'PICKUP_DROPOFF';
  }

  get pickupReady(): boolean {
    return isLocationReady(this.props.wizard.pickup);
  }

  get dropoffReady(): boolean {
    return isLocationReady(this.props.wizard.dropoff);
  }

  get currentValue(): PickedLocation | undefined {
    return (this.local.leg === 'pickup' ? this.props.wizard.pickup : this.props.wizard.dropoff) ?? undefined;
  }

  /** The drop-off picker opens near the pickup, zoomed out enough not to place a pin by itself. */
  get dropoffStart(): { lat: number; lng: number } | undefined {
    const pickup = this.props.wizard.pickup as PickedLocation | null;
    return this.local.leg === 'dropoff' && pickup ? { lat: pickup.latitude, lng: pickup.longitude } : undefined;
  }

  editLeg = (leg: Leg) => {
    this.local.leg = leg;
  };

  onLegChange = (value: PickedLocation | null) => {
    if (this.local.leg === 'pickup') this.props.onPickup(value);
    else this.props.onDropoff(value);
  };

  legText(location: PickedLocation | null, empty: string): string {
    return isLocationReady(location) ? composeAddress(location) : empty;
  }

  legTextClass(location: PickedLocation | null): string {
    return isLocationReady(location) ? 'block truncate font-medium text-ink-900' : 'block truncate text-ink-400';
  }

  legClass(leg: Leg): string {
    const base =
      'flex w-full min-h-[64px] items-start gap-3 rounded-input px-3 py-3 transition-colors duration-micro ease-onsite ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900';
    return this.local.leg === leg ? `${base} bg-brand-50` : `${base} hover:bg-paper-50`;
  }
}
