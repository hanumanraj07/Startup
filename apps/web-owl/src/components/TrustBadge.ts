import { Component, xml } from '@odoo/owl';
import type { PublicWorker } from '@onsite/types';
import { formatMemberSince } from '@/lib/format';
import { Icon } from './Icon';

const LEVELS: { level: number; label: string }[] = [
  { level: 1, label: 'Email and phone verified' },
  { level: 2, label: 'Government ID checked' },
  { level: 3, label: 'Address verified' },
  { level: 4, label: '50+ completions, 4.5+ rating' },
  { level: 5, label: 'Professional tier' },
];

/**
 * What a requester reads before trusting a stranger. Every component is shown
 * separately, never collapsed into one opaque score (docs/19-ui-design-system.md):
 * "4.9 from 187 tasks" is a different claim from "5.0 from one".
 */
export class TrustBadge extends Component {
  static override template = xml`
    <div class="flex flex-col gap-5">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div class="flex flex-col gap-1">
          <span class="text-sm text-ink-500">Rating</span>
          <span class="tabular text-2xl font-bold text-ink-900" t-out="rating"/>
          <span class="text-xs text-ink-400" t-out="ratingHint"/>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-sm text-ink-500">Tasks completed</span>
          <span class="tabular text-2xl font-bold text-ink-900" t-out="props.worker.tasksCompleted"/>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-sm text-ink-500">Completion rate</span>
          <span class="tabular text-2xl font-bold text-ink-900" t-out="completion"/>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-sm text-ink-500">Member since</span>
          <span class="tabular text-2xl font-bold text-ink-900" t-out="memberSince"/>
        </div>
      </div>

      <div>
        <p class="mb-2 text-sm font-medium text-ink-700">Verification level <t t-out="props.worker.verificationLevel"/> of 5</p>
        <ol class="flex flex-col gap-2">
          <li t-foreach="levels" t-as="l" t-key="l.level" class="flex items-center gap-2 text-sm">
            <span t-att-class="badgeClass(l.level)">
              <Icon t-if="reached(l.level)" name="'check'" size="12"/>
              <t t-else="" t-out="l.level"/>
            </span>
            <span t-att-class="reached(l.level) ? 'text-ink-900' : 'text-ink-400'" t-out="l.label"/>
          </li>
        </ol>
      </div>
    </div>`;
  static components = { Icon };
  static override props = { worker: Object };

  levels = LEVELS;

  private get worker(): PublicWorker {
    return this.props.worker as PublicWorker;
  }

  get rating(): string {
    const avg = this.worker.ratingAvg;
    return avg !== null ? avg.toFixed(1) : '—';
  }

  get ratingHint(): string {
    const count = this.worker.ratingCount;
    return count > 0 ? `${count} ratings` : 'No ratings yet';
  }

  get completion(): string {
    const rate = this.worker.completionRate;
    return rate !== null ? `${Math.round(rate)}%` : '—';
  }

  get memberSince(): string {
    return formatMemberSince(this.worker.memberSince);
  }

  reached(level: number): boolean {
    return this.worker.verificationLevel >= level;
  }

  badgeClass(level: number): string {
    const tone = this.reached(level) ? 'bg-verified text-white' : 'bg-paper-100 text-ink-300';
    return `flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${tone}`;
  }
}
