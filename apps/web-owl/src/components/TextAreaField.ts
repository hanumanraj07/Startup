import { Component, xml } from '@odoo/owl';
import { input, LABEL } from '@/ui/classes';

/** Multi-line counterpart of TextField, with the same label, hint and error wiring. */
export class TextAreaField extends Component {
  static override template = xml`
    <div class="flex flex-col gap-1.5">
      <label t-att-for="props.id" class="${LABEL}" t-out="props.label"/>
      <textarea
        t-att-id="props.id"
        t-att-rows="props.rows or 3"
        t-att-maxlength="props.maxlength"
        t-att-class="areaClass"
        t-att-value="props.value"
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
    rows: { type: Number, optional: true },
    maxlength: { type: Number, optional: true },
    error: { type: String, optional: true },
    hint: { type: String, optional: true },
  };

  get areaClass(): string {
    return input(Boolean(this.props.error), 'min-h-[72px] py-2');
  }

  get describedBy(): string | null {
    const { id, error, hint } = this.props;
    if (error) return `${id}-error`;
    return hint ? `${id}-hint` : null;
  }

  onInput(ev: Event) {
    this.props.onInput((ev.target as HTMLTextAreaElement).value);
  }
}
