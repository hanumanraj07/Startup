import { Component, useState, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { TextAreaField } from '@/components/TextAreaField';
import { TextField } from '@/components/TextField';
import type { CityView } from '@/lib/api-types';
import { btn } from '@/ui/classes';

/** Step 2: where the task happens. Cities are a shortcut to set the point, not a restriction. */
export class LocationStep extends Component {
  static override template = xml`
    <div class="flex flex-col gap-4">
      <h2 class="text-lg font-medium text-ink-900">Where is the task?</h2>
      <p class="text-sm text-ink-500">
        OnSite works anywhere in India. Pick the state and nearest city to get started, then refine the exact
        point — or use your current location below.
      </p>

      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium text-ink-700">State</span>
        <div class="flex flex-wrap gap-2">
          <button t-foreach="states" t-as="stateName" t-key="stateName" type="button"
            t-att-class="stateClass(stateName)" t-att-aria-pressed="stateName === local.selectedState ? 'true' : 'false'"
            t-on-click="() => selectState(stateName)" t-out="stateName"/>
        </div>
      </div>

      <div t-if="local.selectedState" class="flex flex-col gap-2">
        <span class="text-sm font-medium text-ink-700">City</span>
        <div class="flex flex-wrap gap-2">
          <button t-foreach="citiesInState" t-as="city" t-key="city.id" type="button" t-att-class="cityClass"
            t-on-click="() => props.onSelectCity(city)">
            <Icon name="'map-pin'" size="16"/> <t t-out="city.name"/>
          </button>
        </div>
      </div>

      <details class="text-xs text-ink-400">
        <summary class="cursor-pointer select-none">Why pick a city first?</summary>
        <p class="mt-1">
          It’s just a fast way to set the point — the list above is a shortcut for common cities, not a
          restriction. Every task still needs a real, verified worker nearby to actually get done, so if your exact
          town isn’t listed, tap “Use my current location” or type the coordinates directly below.
        </p>
      </details>

      <button type="button" t-att-class="locateClass" t-on-click="props.onUseMyLocation">
        <Icon name="'locate-fixed'" size="16"/> Use my current location instead
      </button>

      <p t-if="props.wizard.cityNote" class="text-xs text-ink-400" t-out="props.wizard.cityNote"/>
      <div class="grid grid-cols-2 gap-3">
        <TextField id="'latitude'" label="'Latitude'" type="'number'" step="'any'"
          value="props.wizard.latitudeText" onInput="(v) => props.onField('latitudeText', v)"/>
        <TextField id="'longitude'" label="'Longitude'" type="'number'" step="'any'"
          value="props.wizard.longitudeText" onInput="(v) => props.onField('longitudeText', v)"/>
      </div>
      <TextAreaField id="'address'" label="'Exact address'" rows="2"
        hint="'Shop name, street, landmark — whatever gets a worker there.'"
        value="props.wizard.address" onInput="(v) => props.onField('address', v)"/>
    </div>`;
  static components = { Icon, TextAreaField, TextField };
  static override props = {
    wizard: Object,
    cities: Array,
    onSelectCity: Function,
    onUseMyLocation: Function,
    onField: Function,
  };

  local = useState<{ selectedState: string | null }>({ selectedState: null });

  cityClass = btn('secondary', 'sm');
  locateClass = btn('ghost', 'sm', 'self-start');

  /** Grouped by state so adding a city (any city, any state) is a data change, never a code change. */
  get states(): string[] {
    return [...new Set((this.props.cities as CityView[]).map((c) => c.state))].sort();
  }

  get citiesInState(): CityView[] {
    return (this.props.cities as CityView[]).filter((c) => c.state === this.local.selectedState);
  }

  /** Arrow property: OWL calls methods from inline template arrows without `this`. */
  selectState = (name: string) => {
    this.local.selectedState = name;
  };

  stateClass(name: string): string {
    return btn(name === this.local.selectedState ? 'primary' : 'secondary', 'sm');
  }
}
