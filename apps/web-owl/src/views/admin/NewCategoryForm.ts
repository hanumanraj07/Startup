import { Component, useState, xml } from '@odoo/owl';
import { TextField } from '@/components/TextField';
import { ApiError, api } from '@/services/api';
import { toast } from '@/store/store';
import { btn, card, CARD_CONTENT, CARD_HEADER, CARD_TITLE } from '@/ui/classes';

type Field = 'name' | 'slug' | 'description' | 'icon' | 'minRupees' | 'maxRupees';

const EMPTY = { name: '', slug: '', description: '', icon: '', minRupees: '', maxRupees: '' };

/** Collapsed to a button until asked for. Prices are typed in rupees and sent as integer paise. */
export class NewCategoryForm extends Component {
  static override template = xml`
    <button t-if="!state.open" type="button" t-att-class="openClass" t-on-click="open">Add category</button>
    <section t-else="" t-att-class="cardClass">
      <div class="${CARD_HEADER}"><h3 class="${CARD_TITLE}">New category</h3></div>
      <form class="${CARD_CONTENT} flex flex-col gap-4" novalidate="novalidate" t-on-submit.prevent="submit">
        <div class="grid gap-4 sm:grid-cols-2">
          <TextField id="'cat-name'" label="'Name'" value="state.name" onInput="(v) => setField('name', v)"/>
          <TextField id="'cat-slug'" label="'Slug'" placeholder="'local-photography'" value="state.slug" onInput="(v) => setField('slug', v)"/>
        </div>
        <TextField id="'cat-description'" label="'Description'" value="state.description" onInput="(v) => setField('description', v)"/>
        <div class="grid gap-4 sm:grid-cols-3">
          <TextField id="'cat-icon'" label="'Icon name'" placeholder="'camera'" value="state.icon" onInput="(v) => setField('icon', v)"/>
          <TextField id="'cat-min'" label="'Suggested min (₹)'" type="'number'" min="'0'" value="state.minRupees" onInput="(v) => setField('minRupees', v)"/>
          <TextField id="'cat-max'" label="'Suggested max (₹)'" type="'number'" min="'0'" value="state.maxRupees" onInput="(v) => setField('maxRupees', v)"/>
        </div>
        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
        <div class="flex gap-2">
          <button type="submit" t-att-class="submitClass" t-att-disabled="state.submitting">Create category</button>
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
      await api.post('/admin/categories', {
        slug: state.slug,
        name: state.name,
        description: state.description,
        icon: state.icon,
        suggestedMinPaise: Math.round(Number(state.minRupees) * 100),
        suggestedMaxPaise: Math.round(Number(state.maxRupees) * 100),
      });
      toast('Category created', { variant: 'success' });
      Object.assign(state, EMPTY, { open: false });
      this.props.onCreated();
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : 'Could not create the category.';
    } finally {
      state.submitting = false;
    }
  };
}
