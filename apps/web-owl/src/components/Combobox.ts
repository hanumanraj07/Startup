import { Component, useRef, useState, xml } from '@odoo/owl';
import { input, LABEL } from '@/ui/classes';
import { Icon } from './Icon';

export interface ComboboxOption {
  value: string;
  label: string;
  /** A second, quieter line, e.g. the state under a city. */
  hint?: string;
}

const MAX_SHOWN = 60;

/** Case- and accent-insensitive, so "Bengaluru" matches "bengaluru" and "Kochi" matches "kochi". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * A searchable dropdown: type to filter a long list, pick with a tap or the
 * keyboard. Follows the WAI-ARIA combobox pattern (an input that controls a
 * listbox, the active option announced via aria-activedescendant), with
 * options tall enough to tap on a phone. Controlled: the parent owns `value`.
 */
export class Combobox extends Component {
  static override template = xml`
    <div class="relative flex flex-col gap-1.5" t-on-focusout="onFocusOut">
      <label t-att-for="props.id" class="${LABEL}" t-out="props.label"/>
      <div class="relative">
        <input
          t-ref="input"
          t-att-id="props.id"
          type="text"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          t-att-aria-expanded="state.open ? 'true' : 'false'"
          t-att-aria-controls="listId"
          t-att-aria-activedescendant="activeId"
          t-att-placeholder="props.placeholder"
          t-att-disabled="props.disabled"
          t-att-class="inputClass"
          t-att-value="displayValue"
          t-on-focus="open"
          t-on-click="open"
          t-on-input="onInput"
          t-on-keydown="onKeydown"
        />
        <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden="true">
          <Icon name="'search'" size="16"/>
        </span>
      </div>
      <ul t-if="state.open" t-att-id="listId" role="listbox" t-att-aria-label="props.label"
        class="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-card border border-line-light bg-paper-0 p-1 shadow-float">
        <li t-if="filtered.length === 0" class="px-3 py-3 text-sm text-ink-400" t-out="props.emptyText or 'No matches'"/>
        <li t-foreach="filtered" t-as="option" t-key="option.value"
          t-att-id="optionId(option_index)" role="option"
          t-att-aria-selected="option.value === props.value ? 'true' : 'false'"
          t-att-class="optionClass(option, option_index)"
          t-on-mousedown.prevent="() => choose(option)"
          t-on-mousemove="() => setActive(option_index)">
          <span class="block truncate" t-out="option.label"/>
          <span t-if="option.hint" class="block truncate text-xs text-ink-400" t-out="option.hint"/>
        </li>
      </ul>
    </div>`;
  static components = { Icon };
  static override props = {
    id: String,
    label: String,
    options: Array,
    value: String,
    onSelect: Function,
    placeholder: { type: String, optional: true },
    disabled: { type: Boolean, optional: true },
    emptyText: { type: String, optional: true },
  };

  state = useState({ open: false, query: '', typing: false, active: 0 });
  inputRef = useRef('input');

  get listId(): string {
    return `${this.props.id}-list`;
  }

  get inputClass(): string {
    return input(false, 'pr-9');
  }

  get selected(): ComboboxOption | undefined {
    return (this.props.options as ComboboxOption[]).find((o) => o.value === this.props.value);
  }

  get displayValue(): string {
    return this.state.typing ? this.state.query : (this.selected?.label ?? '');
  }

  get filtered(): ComboboxOption[] {
    const options = this.props.options as ComboboxOption[];
    const q = fold(this.state.typing ? this.state.query.trim() : '');
    const hits = q ? options.filter((o) => fold(o.label).includes(q) || (o.hint ? fold(o.hint).includes(q) : false)) : options;
    return hits.slice(0, MAX_SHOWN);
  }

  get activeId(): string | null {
    return this.state.open && this.filtered.length > 0 ? this.optionId(this.state.active) : null;
  }

  optionId(index: number): string {
    return `${this.props.id}-opt-${index}`;
  }

  optionClass(option: ComboboxOption, index: number): string {
    const base = 'flex min-h-[44px] cursor-pointer flex-col justify-center rounded-input px-3 py-2 text-sm';
    const selected = option.value === this.props.value ? ' font-semibold text-ink-900' : ' text-ink-700';
    return base + selected + (index === this.state.active ? ' bg-brand-50' : '');
  }

  open = () => {
    if (this.props.disabled || this.state.open) return;
    this.state.open = true;
    this.state.typing = false;
    this.state.query = '';
    const index = this.filtered.findIndex((o) => o.value === this.props.value);
    this.state.active = Math.max(0, index);
  };

  close() {
    this.state.open = false;
    this.state.typing = false;
  }

  onInput(ev: Event) {
    this.state.query = (ev.target as HTMLInputElement).value;
    this.state.typing = true;
    this.state.open = true;
    this.state.active = 0;
  }

  setActive = (index: number) => {
    if (this.state.active !== index) this.state.active = index;
  };

  choose = (option: ComboboxOption) => {
    this.props.onSelect(option.value);
    this.close();
  };

  onKeydown(ev: KeyboardEvent) {
    const count = this.filtered.length;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (!this.state.open) this.open();
      else if (count > 0) this.state.active = (this.state.active + 1) % count;
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (count > 0) this.state.active = (this.state.active - 1 + count) % count;
    } else if (ev.key === 'Enter') {
      const option = this.filtered[this.state.active];
      if (this.state.open && option) {
        ev.preventDefault();
        this.choose(option);
      }
    } else if (ev.key === 'Escape') {
      if (this.state.open) {
        ev.preventDefault();
        this.close();
      }
    }
  }

  onFocusOut(ev: FocusEvent) {
    const next = ev.relatedTarget as Node | null;
    if (!next || !(ev.currentTarget as HTMLElement).contains(next)) this.close();
  }
}
