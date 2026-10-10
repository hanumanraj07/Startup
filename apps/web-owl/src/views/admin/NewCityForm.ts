import { Component, useState, xml } from '@odoo/owl';
import { TextField } from '@/components/TextField';
import { ApiError, api } from '@/services/api';
import { toast } from '@/store/store';
import { btn, card, CARD_CONTENT, CARD_HEADER, CARD_TITLE } from '@/ui/classes';

type Field = 'name' | 'stateName' | 'latitude' | 'longitude' | 'radiusKm';

const EMPTY = { name: '', stateName: '', latitude: '', longitude: '', radiusKm: '25' };

/** Collapsed to a button until asked for. The radius is typed in kilometres and sent as metres. */
export class NewCityForm extends Component {
  static override template = xml`
    <button t-if="!state.open" type="button" t-att-class="openClass" t-on-click="open">Add city</button>
    <section t-else="" t-att-class="cardClass">
      <div class="${CARD_HEADER}"><h3 class="${CARD_TITLE}">New city</h3></div>
      <form class="${CARD_CONTENT} flex flex-col gap-4" novalidate="novalidate" t-on-submit.prevent="submit">
        <div class="grid gap-4 sm:grid-cols-2">
          <TextField id="'city-name'" label="'City'" value="state.name" onInput="(v) => setField('name', v)"/>
          <TextField id="'city-state'" label="'State'" value="state.stateName" onInput="(v) => setField('stateName', v)"/>
        </div>
        <div class="grid gap-4 sm:grid-cols-3">
          <TextField id="'city-lat'" label="'Latitude'" type="'number'" step="'any'" value="state.latitude" onInput="(v) => setField('latitude', v)"/>
          <TextField id="'city-lng'" label="'Longitude'" type="'number'" step="'any'" value="state.longitude" onInput="(v) => setField('longitude', v)"/>
          <TextField id="'city-radius'" label="'Radius (km)'" type="'number'" min="'1'" value="state.radiusKm" onInput="(v) => setField('radiusKm', v)"/>
        </div>
        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
        <div class="flex gap-2">
          <button type="submit" t-att-class="submitClass" t-att-disabled="state.submitting">Create city</button>
          <button type="button" t-att-class="cancelClass" t-on-click="close">Cancel</button>
        </div>
      </form>
    </section>`;
  static components = { TextField };
  static override props = { onCreated: Function };

  state = useState({ open: false, ...EMPTY, submitting: false, error: null as string | null });
  openClass = btn('secondary', 'sm', 'mt-3');
  cardClass = card('mt-3');
  submitClass = btn('primary');
  cancelClass = btn('ghost');

  setField = (key: Field, value: string) => {
    this.state[key] = value;
  };

  open() {
    this.state.open = true;
  }

  close = () => {
    this.state.open = false;
  };

  submit = async () => {
    const { state } = this;
    state.submitting = true;
    state.error = null;
    try {
      await api.post('/admin/cities', {
        name: state.name,
        state: state.stateName,
        latitude: Number(state.latitude),
        longitude: Number(state.longitude),
        radiusMeters: Math.round(Number(state.radiusKm) * 1000),
      });
      toast('City created', { variant: 'success' });
      Object.assign(state, EMPTY, { open: false });
      this.props.onCreated();
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : 'Could not create the city.';
    } finally {
      state.submitting = false;
    }
  };
}
