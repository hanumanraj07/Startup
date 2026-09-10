import { describe, expect, it } from 'vitest';
import { EVENT_DEFINITIONS, type NotificationEvent, type NotificationPayload } from './events';
import { renderNotification } from './templates';

const SAMPLE_PAYLOADS: NotificationPayload[] = [
  { event: 'NEW_TASK_NEARBY', taskId: 't1', taskTitle: 'Inspect a laptop', payoutPaise: 42_500, distanceLabel: '2.1 km' },
  { event: 'WORKER_ASSIGNED', taskId: 't1', taskTitle: 'Inspect a laptop', workerName: 'Rahul S.' },
  { event: 'WORKER_EN_ROUTE', taskId: 't1', taskTitle: 'Inspect a laptop', workerName: 'Rahul S.' },
  { event: 'WORKER_ARRIVED', taskId: 't1', taskTitle: 'Inspect a laptop', workerName: 'Rahul S.' },
  { event: 'PROOF_SUBMITTED', taskId: 't1', taskTitle: 'Inspect a laptop' },
  { event: 'TASK_APPROVED', taskId: 't1', taskTitle: 'Inspect a laptop', payoutPaise: 42_500 },
  { event: 'TASK_AUTO_APPROVED', taskId: 't1', taskTitle: 'Inspect a laptop', payoutPaise: 42_500 },
  { event: 'TASK_REJECTED', taskId: 't1', taskTitle: 'Inspect a laptop', reason: 'Photo was blurry' },
  { event: 'PAYMENT_RELEASED', taskId: 't1', taskTitle: 'Inspect a laptop', payoutPaise: 42_500 },
  { event: 'TASK_EXPIRED_REFUNDED', taskId: 't1', taskTitle: 'Inspect a laptop', refundPaise: 50_000 },
  { event: 'NEW_MESSAGE', taskId: 't1', senderName: 'Rahul S.', preview: 'On my way now' },
  { event: 'DISPUTE_RAISED', taskId: 't1', taskTitle: 'Inspect a laptop', raisedByName: 'Hanuman R.' },
  { event: 'DISPUTE_RESOLVED', taskId: 't1', taskTitle: 'Inspect a laptop', resolution: 'SPLIT', notes: 'Partial evidence provided.' },
  { event: 'KYC_APPROVED' },
  { event: 'KYC_REJECTED', reason: 'Document photo was blurry' },
  { event: 'ACCOUNT_SUSPENDED', reason: 'Repeated policy violations' },
  { event: 'RATING_RECEIVED', taskId: 't1', taskTitle: 'Inspect a laptop', rating: 5 },
];

describe('renderNotification', () => {
  it('renders every declared event without throwing, with a non-empty title and body', () => {
    for (const payload of SAMPLE_PAYLOADS) {
      const rendered = renderNotification(payload);
      expect(rendered.title.length).toBeGreaterThan(0);
      expect(rendered.body.length).toBeGreaterThan(0);
      expect(rendered.title).not.toContain('undefined');
      expect(rendered.body).not.toContain('undefined');
    }
  });

  it('covers every event declared in EVENT_DEFINITIONS with at least one sample payload', () => {
    const covered = new Set(SAMPLE_PAYLOADS.map((p) => p.event));
    const declared = Object.keys(EVENT_DEFINITIONS) as NotificationEvent[];
    for (const event of declared) {
      expect(covered.has(event)).toBe(true);
    }
  });

  it('formats currency through packages/money rather than a hand-rolled string', () => {
    const rendered = renderNotification({
      event: 'PAYMENT_RELEASED',
      taskId: 't1',
      taskTitle: 'x',
      payoutPaise: 42_500,
    });
    // formatPaise renders 42,500 paise as ₹425.00 — a hand-rolled formatter
    // would be an easy place to silently drop the rupee symbol or the paise.
    expect(rendered.body).toContain('₹425');
  });

  it('renders correctly with an empty-string optional-shaped field rather than producing "undefined"', () => {
    const rendered = renderNotification({ event: 'TASK_REJECTED', taskId: 't1', taskTitle: 'x', reason: '' });
    expect(rendered.body).not.toContain('undefined');
  });

  it('truncates a long message preview rather than leaking the full body into a push payload', () => {
    const longMessage = 'a'.repeat(500);
    const rendered = renderNotification({ event: 'NEW_MESSAGE', taskId: 't1', senderName: 'Rahul S.', preview: longMessage });
    expect(rendered.body.length).toBeLessThan(150);
    expect(rendered.body.endsWith('…')).toBe(true);
  });

  it('does not truncate a short message preview', () => {
    const rendered = renderNotification({ event: 'NEW_MESSAGE', taskId: 't1', senderName: 'Rahul S.', preview: 'On my way' });
    expect(rendered.body).toBe('On my way');
  });

  it('never includes a phone number, email or amount beyond the payout in a task-activity event', () => {
    const rendered = renderNotification({
      event: 'WORKER_ASSIGNED',
      taskId: 't1',
      taskTitle: 'x',
      workerName: 'Rahul S.',
    });
    expect(rendered.body).not.toMatch(/@|\+91|\d{10}/);
  });
});

describe('EVENT_DEFINITIONS', () => {
  it('marks exactly the payment, dispute and account-security events as non-disableable, per docs/13', () => {
    const nonDisableable = Object.entries(EVENT_DEFINITIONS)
      .filter(([, def]) => def.nonDisableable)
      .map(([event]) => event);
    expect(nonDisableable.sort()).toEqual(
      [
        'PAYMENT_RELEASED',
        'TASK_APPROVED',
        'TASK_AUTO_APPROVED',
        'TASK_EXPIRED_REFUNDED',
        'DISPUTE_RAISED',
        'DISPUTE_RESOLVED',
        'KYC_APPROVED',
        'KYC_REJECTED',
        'ACCOUNT_SUSPENDED',
      ].sort(),
    );
  });

  it('every event includes IN_APP, since in-app is the durable fallback for everything', () => {
    for (const def of Object.values(EVENT_DEFINITIONS)) {
      expect(def.channels).toContain('IN_APP');
    }
  });
});
