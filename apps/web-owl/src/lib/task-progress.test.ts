import { describe, expect, it } from 'vitest';
import { buildProgress, isTracking, stepsFor } from './task-progress';

const states = (status: Parameters<typeof buildProgress>[0], mode: Parameters<typeof buildProgress>[1] = 'SINGLE') =>
  buildProgress(status, mode).steps.map((s) => `${s.key}:${s.state}`);

describe('task progress steps', () => {
  it('gives an inspection no pickup or delivery steps, and a delivery no "doing the task"', () => {
    const inspection = stepsFor('SINGLE').map((s) => s.key);
    const delivery = stepsFor('PICKUP_DROPOFF').map((s) => s.key);
    expect(inspection).toContain('working');
    expect(inspection).not.toContain('delivering');
    expect(delivery).toEqual(expect.arrayContaining(['to-pickup', 'at-pickup', 'delivering']));
    expect(delivery).not.toContain('working');
  });

  it('marks everything before the current status done, and everything after upcoming', () => {
    expect(states('WORKER_EN_ROUTE')).toEqual([
      'posted:done',
      'finding:done',
      'assigned:done',
      'on-the-way:current',
      'arrived:upcoming',
      'working:upcoming',
      'proof:upcoming',
      'completed:upcoming',
      'paid:upcoming',
    ]);
  });

  it('counts the final step as done, not as something still to wait for', () => {
    const last = buildProgress('PAYMENT_RELEASED', 'SINGLE').steps.at(-1);
    expect(last?.state).toBe('done');
  });

  it('stops at the furthest step reached when a task leaves the path, and says why', () => {
    const { steps, offPath } = buildProgress('CANCELLED', 'SINGLE', [
      { status: 'DRAFT', at: '2026-10-19T08:00:00Z', actorRole: 'REQUESTER', reason: null },
      { status: 'PUBLISHED', at: '2026-10-19T08:01:00Z', actorRole: 'REQUESTER', reason: null },
      { status: 'CANCELLED', at: '2026-10-19T08:05:00Z', actorRole: 'REQUESTER', reason: null },
    ]);
    expect(offPath).toBe('Cancelled');
    expect(steps.filter((s) => s.state === 'current')).toHaveLength(0);
    expect(steps.find((s) => s.key === 'finding')?.state).toBe('done');
    expect(steps.find((s) => s.key === 'assigned')?.state).toBe('upcoming');
  });

  it('takes the time each step was reached from the history', () => {
    const { steps } = buildProgress('ASSIGNED', 'SINGLE', [
      { status: 'MATCHING', at: '2026-10-19T08:02:00Z', actorRole: 'SYSTEM', reason: null },
      { status: 'ASSIGNED', at: '2026-10-19T08:04:00Z', actorRole: 'WORKER', reason: null },
    ]);
    expect(steps.find((s) => s.key === 'finding')?.at).toBe('2026-10-19T08:02:00Z');
    expect(steps.find((s) => s.key === 'assigned')?.at).toBe('2026-10-19T08:04:00Z');
  });
});

describe('isTracking — mirrors the API rule', () => {
  it('is on only while on the way, and for deliveries while carrying the item', () => {
    expect(isTracking('ASSIGNED', 'SINGLE')).toBe(false);
    expect(isTracking('WORKER_EN_ROUTE', 'SINGLE')).toBe(true);
    expect(isTracking('IN_PROGRESS', 'SINGLE')).toBe(false);
    expect(isTracking('IN_PROGRESS', 'PICKUP_DROPOFF')).toBe(true);
    expect(isTracking('ARRIVED', 'PICKUP_DROPOFF')).toBe(false);
  });
});
