import type { TaskStatus } from '@onsite/types';

/*
 * These sets mirror the backend's rules exactly. They gate which controls the
 * UI offers; the API enforces the same rules and is the real authority, so a
 * drift here shows up as a control that errors, never as a bypass. Source of
 * truth: apps/api/src/modules/tasks/transitions.ts and chat/chat.service.ts.
 */

/** Chat history is visible for a task's whole life once a worker was assigned. */
export const CHAT_VISIBLE_STATUSES: readonly TaskStatus[] = [
  'ASSIGNED',
  'WORKER_EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'COMPLETED',
  'PAYMENT_RELEASED',
  'DISPUTED',
];

/** New messages are only accepted in these (backend: [...ACTIVE_WORK, ...AWAITING_REVIEW]). */
export const CHAT_WRITABLE_STATUSES: readonly TaskStatus[] = [
  'ASSIGNED',
  'WORKER_EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
];

/** Backend DISPUTABLE_STATUSES: the states a task can be reported (disputed) from. */
export const REPORTABLE_STATUSES: readonly TaskStatus[] = [
  'ASSIGNED',
  'WORKER_EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'COMPLETED',
];

/** Proofs exist, or can be added, from ARRIVED onward. */
export const PROOF_VISIBLE_STATUSES: readonly TaskStatus[] = [
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'COMPLETED',
  'PAYMENT_RELEASED',
  'DISPUTED',
];

/** Backend ACTIVE_WORK: the assigned worker may leave the task from any of these (transitions.ts). */
export const LEAVABLE_STATUSES: readonly TaskStatus[] = ['ASSIGNED', 'WORKER_EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

/** Backend REMOVABLE_BEFORE_ARRIVAL: the requester may remove the worker only before they arrive. */
export const WORKER_REMOVABLE_STATUSES: readonly TaskStatus[] = ['ASSIGNED', 'WORKER_EN_ROUTE'];
