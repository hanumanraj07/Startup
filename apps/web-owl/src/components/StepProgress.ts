import { Component, xml } from '@odoo/owl';
import { Icon } from './Icon';

/** The wizard's progress bar: numbered steps joined by lines that fill as steps complete. */
export class StepProgress extends Component {
  static override template = xml`
    <ol class="flex items-center gap-2" aria-label="Progress">
      <li t-foreach="props.steps" t-as="label" t-key="label" class="flex flex-1 items-center gap-2">
        <div t-att-class="dotClass(label_index)" t-att-aria-current="isActive(label_index) ? 'step' : null">
          <Icon t-if="isDone(label_index)" name="'check'" size="14"/>
          <t t-else="" t-out="label_index + 1"/>
        </div>
        <span t-att-class="labelClass(label_index)" t-out="label"/>
        <div t-if="label_index !== props.steps.length - 1" class="relative h-px flex-1 bg-line">
          <div class="absolute inset-y-0 left-0 bg-verified transition-all duration-page ease-onsite" t-att-style="fillStyle(label_index)"/>
        </div>
      </li>
    </ol>`;
  static components = { Icon };
  static override props = {
    steps: Array,
    current: Number,
  };

  isDone(i: number): boolean {
    return i < this.props.current;
  }

  isActive(i: number): boolean {
    return i === this.props.current;
  }

  dotClass(i: number): string {
    const tone = this.isDone(i)
      ? 'bg-verified text-white'
      : this.isActive(i)
        ? 'bg-brand-solid text-ink-900'
        : 'bg-paper-100 text-ink-400';
    return `flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-base ease-onsite ${tone}`;
  }

  labelClass(i: number): string {
    return `hidden text-sm sm:inline ${this.isActive(i) ? 'font-medium text-ink-900' : 'text-ink-400'}`;
  }

  fillStyle(i: number): string {
    return `width:${this.isDone(i) ? '100%' : '0%'}`;
  }
}
