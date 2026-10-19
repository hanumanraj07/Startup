import { Component, xml } from '@odoo/owl';
import { formatDateTime } from '@/lib/format';
import type { ProgressStep } from '@/lib/task-progress';
import { Icon } from './Icon';

/**
 * A task's life as a vertical list of steps, the current one highlighted and
 * explained, finished ones ticked with the time they happened. Built from
 * buildProgress(); never decides anything itself.
 */
export class ProgressSteps extends Component {
  static override template = xml`
    <ol class="flex flex-col" aria-label="Task progress">
      <li t-foreach="props.steps" t-as="step" t-key="step.key" class="relative flex gap-3 pb-5 last:pb-0"
        t-att-aria-current="step.state === 'current' ? 'step' : null">
        <span t-if="!step_last" t-att-class="lineClass(step)" aria-hidden="true"/>
        <span t-att-class="dotClass(step)" aria-hidden="true">
          <Icon t-if="step.state === 'done'" name="'check'" size="14"/>
          <span t-elif="step.state === 'current'" class="h-2.5 w-2.5 rounded-full bg-ink-900"/>
        </span>
        <div class="min-w-0 pt-0.5">
          <p t-att-class="labelClass(step)" t-out="step.label"/>
          <p t-if="step.state === 'current' and step.detail" class="mt-0.5 text-sm text-ink-500" t-out="step.detail"/>
          <p t-elif="step.state === 'done' and step.at" class="tabular mt-0.5 text-xs text-ink-400" t-out="when(step.at)"/>
        </div>
      </li>
    </ol>
    <p t-if="props.offPath" class="mt-3 rounded-input bg-paper-100 px-3 py-2 text-sm font-medium text-ink-700" t-out="props.offPath"/>`;
  static components = { Icon };
  static override props = {
    steps: Array,
    offPath: { type: String, optional: true },
  };

  when(at: string): string {
    return formatDateTime(at);
  }

  dotClass(step: ProgressStep): string {
    const base = 'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full';
    if (step.state === 'done') return `${base} bg-accent-600 text-white`;
    if (step.state === 'current') return `${base} bg-brand-solid ring-4 ring-brand-100`;
    return `${base} border-2 border-line bg-paper-0`;
  }

  lineClass(step: ProgressStep): string {
    return `absolute left-[11px] top-6 bottom-0 w-0.5 ${step.state === 'done' ? 'bg-accent-600' : 'bg-line'}`;
  }

  labelClass(step: ProgressStep): string {
    if (step.state === 'current') return 'font-bold text-ink-900';
    if (step.state === 'done') return 'font-medium text-ink-700';
    return 'text-ink-400';
  }
}
