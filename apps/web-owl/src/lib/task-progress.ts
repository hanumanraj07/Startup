import type { LocationMode, TaskStatus } from '@onsite/types';
import type { StatusEvent } from './api-types';

/**
 * The task's life as numbered steps both parties can follow, built from the
 * server's status and the task's type. Pure and display-only: the server owns
 * the state machine (transitions.ts); this only names where a task is in it.
 * A delivery has its own legs (heading to pickup, picked up, delivering); an
 * inspection does not ask for any of them.
 */

export type StepState = 'done' | 'current' | 'upcoming';

export interface ProgressStep {
  key: string;
  label: string;
  /** A line under the label: what it means, or what happens next. */
  detail?: string;
  state: StepState;
  /** When the step was reached, from the status history. */
  at?: string;
}

interface StepDef {
  key: string;
  label: string;
  /** The statuses that mean "this step is where the task is now". */
  statuses: readonly TaskStatus[];
  detail?: string;
}

const COMMON_HEAD: StepDef[] = [
  { key: 'posted', label: 'Task posted', statuses: ['DRAFT'], detail: 'Funded and published.' },
  { key: 'finding', label: 'Finding a worker', statuses: ['PUBLISHED', 'MATCHING'], detail: 'Sent to verified workers nearby.' },
  { key: 'assigned', label: 'Worker assigned', statuses: ['ASSIGNED'], detail: 'Accepted and confirmed.' },
];

const INSPECTION_MIDDLE: StepDef[] = [
  { key: 'on-the-way', label: 'On the way', statuses: ['WORKER_EN_ROUTE'], detail: 'Live location is shared until arrival.' },
  { key: 'arrived', label: 'Arrived', statuses: ['ARRIVED'], detail: 'Arrival checked against the task location.' },
  { key: 'working', label: 'Doing the task', statuses: ['IN_PROGRESS'], detail: 'Collecting the proof you asked for.' },
];

const DELIVERY_MIDDLE: StepDef[] = [
  { key: 'to-pickup', label: 'Heading to pickup', statuses: ['WORKER_EN_ROUTE'], detail: 'Live location is shared until pickup.' },
  { key: 'at-pickup', label: 'At the pickup', statuses: ['ARRIVED'], detail: 'Photographing the item before collecting it.' },
  { key: 'delivering', label: 'Picked up, delivering', statuses: ['IN_PROGRESS'], detail: 'Live location is shared until handover.' },
];

const COMMON_TAIL: StepDef[] = [
  { key: 'proof', label: 'Proof submitted', statuses: ['SUBMITTED', 'UNDER_REVIEW'], detail: 'Waiting for review. Auto-approves after 24 hours.' },
  { key: 'completed', label: 'Completed', statuses: ['COMPLETED'], detail: 'Approved. Payment is being released.' },
  { key: 'paid', label: 'Payment settled', statuses: ['PAYMENT_RELEASED'], detail: 'The worker has been paid.' },
];

/** Statuses that leave the happy path; the steps stop at where the task was. */
const OFF_PATH: Partial<Record<TaskStatus, string>> = {
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired: nobody accepted before the deadline',
  DISPUTED: 'Under review by OnSite',
};

export function stepsFor(locationMode: LocationMode): readonly StepDef[] {
  return [...COMMON_HEAD, ...(locationMode === 'PICKUP_DROPOFF' ? DELIVERY_MIDDLE : INSPECTION_MIDDLE), ...COMMON_TAIL];
}

/**
 * The steps with their state. For a cancelled, expired or disputed task the
 * steps reached before it stay done and the rest are left upcoming; `offPath`
 * names what happened instead.
 */
export function buildProgress(
  status: TaskStatus,
  locationMode: LocationMode,
  history: readonly StatusEvent[] = [],
): { steps: ProgressStep[]; offPath: string | null } {
  const defs = stepsFor(locationMode);
  const reachedAt = new Map<string, string>();
  for (const event of history) {
    const def = defs.find((d) => d.statuses.includes(event.status));
    if (def && !reachedAt.has(def.key)) reachedAt.set(def.key, event.at);
  }

  const offPath = OFF_PATH[status] ?? null;
  let currentIndex = defs.findIndex((d) => d.statuses.includes(status));
  if (currentIndex < 0) {
    // Off the path: "current" is the furthest step the history reached.
    currentIndex = defs.reduce((furthest, d, i) => (reachedAt.has(d.key) ? i : furthest), -1);
  }

  const steps = defs.map((d, i): ProgressStep => {
    const state: StepState = i < currentIndex ? 'done' : i === currentIndex && !offPath ? 'current' : i === currentIndex ? 'done' : 'upcoming';
    // The last step is a fact, not a wait: once it is the status, it is done.
    const final = i === defs.length - 1 && state === 'current' ? 'done' : state;
    return { key: d.key, label: d.label, detail: d.detail, state: final, at: reachedAt.get(d.key) };
  });
  return { steps, offPath };
}

/**
 * Whether the worker's live location is being shared now. Mirrors the API's
 * trackingLeg (realtime/live-location.service.ts): on the way, and for a
 * delivery also while carrying the item.
 */
export function isTracking(status: TaskStatus, locationMode: LocationMode): boolean {
  return status === 'WORKER_EN_ROUTE' || (status === 'IN_PROGRESS' && locationMode === 'PICKUP_DROPOFF');
}
