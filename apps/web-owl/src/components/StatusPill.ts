import { Component, xml } from '@odoo/owl';
import type { TaskStatus } from '@onsite/types';
import { Icon } from './Icon';

type Tone = 'progress' | 'verified' | 'dispute' | 'neutral';

/**
 * One status -> one tone -> one icon, identical everywhere. Colour is never
 * the only signal (docs/19-ui-design-system.md): every pill also carries an
 * icon and a text label. Tones follow Bootstrap/Odoo badge colours.
 */
const STATUS_META: Record<TaskStatus, { label: string; tone: Tone; icon: string }> = {
  DRAFT: { label: 'Draft', tone: 'neutral', icon: 'file-check' },
  PUBLISHED: { label: 'Published', tone: 'progress', icon: 'clock' },
  MATCHING: { label: 'Finding a worker', tone: 'progress', icon: 'scan-search' },
  ASSIGNED: { label: 'Assigned', tone: 'progress', icon: 'package-check' },
  WORKER_EN_ROUTE: { label: 'Worker en route', tone: 'progress', icon: 'navigation' },
  ARRIVED: { label: 'Worker arrived', tone: 'progress', icon: 'map-pin' },
  IN_PROGRESS: { label: 'In progress', tone: 'progress', icon: 'clock' },
  SUBMITTED: { label: 'Submitted for review', tone: 'progress', icon: 'file-check' },
  UNDER_REVIEW: { label: 'Under review', tone: 'progress', icon: 'scan-search' },
  COMPLETED: { label: 'Completed', tone: 'verified', icon: 'circle-check' },
  PAYMENT_RELEASED: { label: 'Paid', tone: 'verified', icon: 'wallet' },
  DISPUTED: { label: 'Disputed', tone: 'dispute', icon: 'alert-triangle' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: 'ban' },
  EXPIRED: { label: 'Expired', tone: 'neutral', icon: 'circle-x' },
};

const TONE_CLASSES: Record<Tone, string> = {
  progress: 'bg-tint-orange text-[#9a4a00]',
  verified: 'bg-tint-green text-accent-700',
  dispute: 'bg-[#fde8e7] text-[#a3241a]',
  neutral: 'bg-paper-100 text-ink-500',
};

export class StatusPill extends Component {
  static override template = xml`
    <span t-att-class="pillClass">
      <Icon name="meta.icon" size="14" class="iconClass"/>
      <t t-out="meta.label"/>
    </span>`;
  static components = { Icon };
  static override props = {
    status: String,
  };

  get meta() {
    return STATUS_META[this.props.status as TaskStatus] ?? { label: this.props.status, tone: 'neutral' as Tone, icon: 'circle' };
  }

  get pillClass(): string {
    return `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${TONE_CLASSES[this.meta.tone]}`;
  }

  /** Active states breathe gently so "something is happening" reads at a glance; finished and inert states stay still. */
  get iconClass(): string {
    const tone = this.meta.tone;
    return tone === 'progress' || tone === 'dispute' ? 'animate-pulse' : '';
  }
}
