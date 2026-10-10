import { Component, useEffect, useRef, xml } from '@odoo/owl';
import { input, LABEL } from '@/ui/classes';

/**
 * A label, input, hint and error wired together with the right aria
 * attributes so a screen reader announces the error against the field —
 * per docs/19-ui-design-system.md, form errors are never colour alone.
 */
export class TextField extends Component {
  static override template = xml`
    <div class="flex flex-col gap-1.5">
      <label t-att-for="props.id" class="${LABEL}" t-out="props.label"/>
      <input
        t-att-id="props.id"
        t-ref="input"
        t-att-type="props.type or 'text'"
        t-att-autocomplete="props.autocomplete"
        t-att-placeholder="props.placeholder"
        t-att-step="props.step"
        t-att-min="props.min"
        t-att-max="props.max"
        t-att-maxlength="props.maxlength"
        t-att-class="inputClass"
        t-att-aria-invalid="props.error ? 'true' : null"
        t-att-aria-describedby="describedBy"
        t-on-input="onInput"
      />
      <p t-if="props.hint and !props.error" t-att-id="props.id + '-hint'" class="text-sm text-ink-400" t-out="props.hint"/>
      <p t-if="props.error" t-att-id="props.id + '-error'" role="alert" class="text-sm text-dispute" t-out="props.error"/>
    </div>`;
  static override props = {
    id: String,
    label: String,
    value: String,
    onInput: Function,
    type: { type: String, optional: true },
    autocomplete: { type: String, optional: true },
    placeholder: { type: String, optional: true },
    step: { type: String, optional: true },
    min: { type: String, optional: true },
    max: { type: String, optional: true },
    maxlength: { type: Number, optional: true },
    error: { type: String, optional: true },
    hint: { type: String, optional: true },
  };

  private inputRef = useRef('input');

  override setup() {
    // The value is written from here rather than a t-att-value binding so a
    // number input being typed into is never rewritten under the user: Chrome
    // reports "22." as "22", and writing that back drops the dot and moves the
    // caret. While such a field is focused and already numerically equal to
    // the state, leave it alone.
    useEffect(
      () => {
        const el = this.inputRef.el as HTMLInputElement | null;
        if (!el || el.value === this.props.value) return;
        const typing = el.type === 'number' && document.activeElement === el;
        if (typing && Number(el.value) === Number(this.props.value)) return;
        el.value = this.props.value;
      },
      () => [this.props.value],
    );
  }

  get inputClass(): string {
    return input(Boolean(this.props.error));
  }

  get describedBy(): string | null {
    const { id, error, hint } = this.props;
    if (error) return `${id}-error`;
    return hint ? `${id}-hint` : null;
  }

  onInput(ev: Event) {
    this.props.onInput((ev.target as HTMLInputElement).value);
  }
}
