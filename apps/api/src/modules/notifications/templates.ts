import { formatPaise } from '@onsite/money';
import type { NotificationPayload } from './events';

export interface RenderedNotification {
  title: string;
  body: string;
}

/**
 * Renders the title and body for every notification event. Deliberately pure
 * and free of any I/O, like scoring.ts and transitions.ts, so every event's
 * copy is tested directly rather than only observed through a live send.
 *
 * Content rules from docs/13-notification-system.md, followed throughout:
 * never a phone number or email address of the other party, never an amount
 * beyond the task payout, never an OTP/token/document number, currency always
 * through `formatPaise` rather than hand-formatted.
 */
export function renderNotification(payload: NotificationPayload): RenderedNotification {
  switch (payload.event) {
    case 'NEW_TASK_NEARBY':
      return {
        title: 'New task nearby',
        body: `${payload.taskTitle} — ${formatPaise(payload.payoutPaise)} · ${payload.distanceLabel} away`,
      };
    case 'WORKER_ASSIGNED':
      return {
        title: 'Worker assigned',
        body: `${payload.workerName} accepted "${payload.taskTitle}" and will be in touch.`,
      };
    case 'WORKER_EN_ROUTE':
      return {
        title: 'Worker on the way',
        body: `${payload.workerName} is en route for "${payload.taskTitle}".`,
      };
    case 'WORKER_ARRIVED':
      return {
        title: 'Worker has arrived',
        body: `${payload.workerName} has arrived at the task location for "${payload.taskTitle}".`,
      };
    case 'PROOF_SUBMITTED':
      return {
        title: 'Proof submitted, ready for review',
        body: `Evidence for "${payload.taskTitle}" is ready. You have 24 hours to review before it auto-approves.`,
      };
    case 'TASK_APPROVED':
      return {
        title: 'Payment released',
        body: `"${payload.taskTitle}" was approved. ${formatPaise(payload.payoutPaise)} has been released to the worker.`,
      };
    case 'TASK_AUTO_APPROVED':
      return {
        title: 'Task auto-approved',
        body: `"${payload.taskTitle}" was auto-approved after the 24-hour review window. ${formatPaise(payload.payoutPaise)} has been released.`,
      };
    case 'TASK_REJECTED':
      return {
        title: 'Rework requested',
        body: `"${payload.taskTitle}" was sent back: ${payload.reason}`,
      };
    case 'PAYMENT_RELEASED':
      return {
        title: 'You have been paid',
        body: `${formatPaise(payload.payoutPaise)} has been released for "${payload.taskTitle}".`,
      };
    case 'TASK_EXPIRED_REFUNDED':
      return {
        title: 'Task expired, refunded',
        body: `Nobody accepted "${payload.taskTitle}" before its deadline. ${formatPaise(payload.refundPaise)} has been refunded.`,
      };
    case 'NEW_MESSAGE':
      return {
        title: `New message from ${payload.senderName}`,
        body: truncate(payload.preview, 140),
      };
    case 'DISPUTE_RAISED':
      return {
        title: 'Dispute raised',
        body: `${payload.raisedByName} raised a dispute on "${payload.taskTitle}". Payment is frozen pending review.`,
      };
    case 'DISPUTE_RESOLVED':
      return {
        title: 'Dispute resolved',
        body: `"${payload.taskTitle}": ${describeDisputeResolution(payload.resolution)}. ${payload.notes}`,
      };
    case 'KYC_APPROVED':
      return {
        title: 'Verification approved',
        body: 'Your identity verification was approved. You can now accept higher-value tasks.',
      };
    case 'KYC_REJECTED':
      return {
        title: 'Verification not approved',
        body: `Your identity verification was not approved: ${payload.reason}`,
      };
    case 'ACCOUNT_SUSPENDED':
      return {
        title: 'Your account has been suspended',
        body: payload.reason,
      };
    case 'RATING_RECEIVED':
      return {
        title: 'You received a new rating',
        body: `${'★'.repeat(payload.rating)}${'☆'.repeat(5 - payload.rating)} for "${payload.taskTitle}".`,
      };
  }
}

function describeDisputeResolution(resolution: string): string {
  switch (resolution) {
    case 'RELEASE_TO_WORKER':
      return 'payment was released to the worker';
    case 'REFUND_TO_REQUESTER':
      return 'the requester was refunded';
    case 'SPLIT':
      return 'payment was split between both parties';
    default:
      return 'a decision was made';
  }
}

/** Keeps a push payload small and avoids dumping a whole long message into a notification. */
function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
