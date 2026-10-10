import { Component, xml } from '@odoo/owl';
import { card } from '@/ui/classes';

interface Step {
  label: string;
  time: string;
  done: boolean;
  current?: boolean;
}

const STEPS: Step[] = [
  { label: 'Task funded and published', time: '11:02 AM', done: true },
  { label: 'Rahul S. accepted', time: '11:14 AM', done: true },
  { label: 'Arrived at XYZ Computer Store', time: '11:52 AM · 38 m from pin', done: true },
  { label: 'Evidence submitted', time: '12:10 PM', done: false, current: true },
  { label: 'Your review', time: 'awaiting', done: false },
];

/**
 * A static preview of the live task timeline, the screen the design doc calls
 * the one that "makes remote feel safe". Every completed step carries a
 * timestamp; nothing is asserted without a time attached to it.
 */
export class TaskTimelinePreview extends Component {
  static override template = xml`
    <div t-att-class="cardClass">
      <p class="text-sm font-semibold text-ink-900">Inspect MacBook Air M4</p>
      <p class="text-xs text-ink-400">Kolkata, West Bengal</p>

      <ol class="mt-4">
        <li t-foreach="steps" t-as="step" t-key="step.label" class="relative flex gap-3 pb-5 last:pb-0">
          <span t-if="!isLast(step_index)" aria-hidden="true" t-att-class="railClass(step)"/>
          <span aria-hidden="true" t-att-class="dotClass(step)"/>
          <div class="min-w-0">
            <p t-att-class="labelClass(step)" t-out="step.label"/>
            <p class="tabular text-xs text-ink-400" t-out="step.time"/>
          </div>
        </li>
      </ol>
    </div>`;
  static override props = {};

  steps = STEPS;
  cardClass = card('w-full max-w-sm p-5');

  isLast(index: number): boolean {
    return index === STEPS.length - 1;
  }

  railClass(step: Step): string {
    return `absolute left-[7px] top-4 h-full w-px ${step.done ? 'bg-verified' : 'bg-line'}`;
  }

  dotClass(step: Step): string {
    const tone = step.done
      ? 'border-verified bg-verified'
      : step.current
        ? 'border-progress bg-paper-0'
        : 'border-line bg-paper-0';
    return `relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${tone}`;
  }

  labelClass(step: Step): string {
    return `text-sm ${step.done || step.current ? 'font-medium text-ink-900' : 'text-ink-400'}`;
  }
}
