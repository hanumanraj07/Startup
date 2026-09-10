/**
 * The event-to-channel table from docs/13-notification-system.md, made
 * concrete. Every notification the platform sends is declared here — nothing
 * else in the codebase should decide on its own which channels an event uses.
 *
 * Scope note: this covers the events that are actually wireable given what
 * exists today. KYC approved/rejected (no admin review UI yet), disputes
 * (Phase 9), ratings (Phase 9) and account suspension (no suspension flow
 * yet) are honestly left out rather than wired to nothing — see TODO.md and
 * ai/memory.md for the exact gap list.
 */

export type NotificationChannel = 'PUSH' | 'EMAIL' | 'IN_APP';

/**
 * The four categories a user can independently control, from docs/13's
 * Preferences section. PAYMENTS is still a togglable category in principle,
 * but every event flagged `nonDisableable` below ignores the stored
 * preference at dispatch time and always sends — "these are records the user
 * needs whether or not they want them."
 */
export type NotificationCategory = 'TASK_ACTIVITY' | 'MESSAGES' | 'PAYMENTS' | 'MARKETING';

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'TASK_ACTIVITY',
  'MESSAGES',
  'PAYMENTS',
  'MARKETING',
];

export type NotificationEvent =
  | 'NEW_TASK_NEARBY'
  | 'WORKER_ASSIGNED'
  | 'WORKER_EN_ROUTE'
  | 'WORKER_ARRIVED'
  | 'PROOF_SUBMITTED'
  | 'TASK_APPROVED'
  | 'TASK_AUTO_APPROVED'
  | 'TASK_REJECTED'
  | 'PAYMENT_RELEASED'
  | 'TASK_EXPIRED_REFUNDED'
  | 'NEW_MESSAGE'
  | 'DISPUTE_RAISED'
  | 'DISPUTE_RESOLVED'
  | 'KYC_APPROVED'
  | 'KYC_REJECTED'
  | 'ACCOUNT_SUSPENDED'
  | 'RATING_RECEIVED';

export interface EventDefinition {
  category: NotificationCategory;
  channels: readonly NotificationChannel[];
  /** Payment, dispute and account-security events per docs/13's Preferences section. */
  nonDisableable?: boolean;
}

export const EVENT_DEFINITIONS: Record<NotificationEvent, EventDefinition> = {
  NEW_TASK_NEARBY: { category: 'TASK_ACTIVITY', channels: ['PUSH', 'IN_APP'] },
  WORKER_ASSIGNED: { category: 'TASK_ACTIVITY', channels: ['PUSH', 'EMAIL', 'IN_APP'] },
  WORKER_EN_ROUTE: { category: 'TASK_ACTIVITY', channels: ['PUSH', 'IN_APP'] },
  WORKER_ARRIVED: { category: 'TASK_ACTIVITY', channels: ['PUSH', 'IN_APP'] },
  PROOF_SUBMITTED: { category: 'TASK_ACTIVITY', channels: ['PUSH', 'EMAIL', 'IN_APP'] },
  TASK_APPROVED: { category: 'PAYMENTS', channels: ['PUSH', 'EMAIL', 'IN_APP'], nonDisableable: true },
  TASK_AUTO_APPROVED: { category: 'PAYMENTS', channels: ['PUSH', 'EMAIL', 'IN_APP'], nonDisableable: true },
  TASK_REJECTED: { category: 'TASK_ACTIVITY', channels: ['PUSH', 'EMAIL', 'IN_APP'] },
  PAYMENT_RELEASED: { category: 'PAYMENTS', channels: ['PUSH', 'EMAIL', 'IN_APP'], nonDisableable: true },
  TASK_EXPIRED_REFUNDED: { category: 'PAYMENTS', channels: ['PUSH', 'EMAIL', 'IN_APP'], nonDisableable: true },
  NEW_MESSAGE: { category: 'MESSAGES', channels: ['PUSH', 'IN_APP'] },
  // Dispute and account-security events per docs/13's Preferences section:
  // "cannot be disabled: payment events, dispute events, account security
  // events." There is no dedicated DISPUTES or ACCOUNT category among the
  // four docs/13 actually names for user-facing preferences (task activity,
  // messages, payments, marketing), so these are bucketed under the closest
  // fit and forced non-disableable rather than left togglable by accident.
  DISPUTE_RAISED: { category: 'PAYMENTS', channels: ['PUSH', 'EMAIL', 'IN_APP'], nonDisableable: true },
  DISPUTE_RESOLVED: { category: 'PAYMENTS', channels: ['PUSH', 'EMAIL', 'IN_APP'], nonDisableable: true },
  KYC_APPROVED: { category: 'TASK_ACTIVITY', channels: ['PUSH', 'EMAIL', 'IN_APP'], nonDisableable: true },
  KYC_REJECTED: { category: 'TASK_ACTIVITY', channels: ['PUSH', 'EMAIL', 'IN_APP'], nonDisableable: true },
  ACCOUNT_SUSPENDED: { category: 'TASK_ACTIVITY', channels: ['EMAIL', 'IN_APP'], nonDisableable: true },
  RATING_RECEIVED: { category: 'TASK_ACTIVITY', channels: ['IN_APP'] },
};

export type NotificationPayload =
  | { event: 'NEW_TASK_NEARBY'; taskId: string; taskTitle: string; payoutPaise: number; distanceLabel: string }
  | { event: 'WORKER_ASSIGNED'; taskId: string; taskTitle: string; workerName: string }
  | { event: 'WORKER_EN_ROUTE'; taskId: string; taskTitle: string; workerName: string }
  | { event: 'WORKER_ARRIVED'; taskId: string; taskTitle: string; workerName: string }
  | { event: 'PROOF_SUBMITTED'; taskId: string; taskTitle: string }
  | { event: 'TASK_APPROVED'; taskId: string; taskTitle: string; payoutPaise: number }
  | { event: 'TASK_AUTO_APPROVED'; taskId: string; taskTitle: string; payoutPaise: number }
  | { event: 'TASK_REJECTED'; taskId: string; taskTitle: string; reason: string }
  | { event: 'PAYMENT_RELEASED'; taskId: string; taskTitle: string; payoutPaise: number }
  | { event: 'TASK_EXPIRED_REFUNDED'; taskId: string; taskTitle: string; refundPaise: number }
  | { event: 'NEW_MESSAGE'; taskId: string; senderName: string; preview: string }
  | { event: 'DISPUTE_RAISED'; taskId: string; taskTitle: string; raisedByName: string }
  | { event: 'DISPUTE_RESOLVED'; taskId: string; taskTitle: string; resolution: string; notes: string }
  | { event: 'KYC_APPROVED' }
  | { event: 'KYC_REJECTED'; reason: string }
  | { event: 'ACCOUNT_SUSPENDED'; reason: string }
  | { event: 'RATING_RECEIVED'; taskId: string; taskTitle: string; rating: number };
