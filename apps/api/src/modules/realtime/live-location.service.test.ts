import { describe, expect, it } from 'vitest';
import { trackingLeg } from './live-location.service';

/**
 * When a worker's live location is shared (founder decision, 2026-10-19):
 * from "On my way" until arrival, and for deliveries while the item is being
 * carried. Never right after accepting, which would often reveal the
 * worker's home, and never once the trip is over.
 */
describe('trackingLeg', () => {
  it('shares only while on the way to a one-place task', () => {
    expect(trackingLeg('WORKER_EN_ROUTE', false)).toBe('to_task');
    for (const status of ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED'] as const) {
      expect(trackingLeg(status, false), status).toBeNull();
    }
  });

  it('shares on both legs of a delivery, and not in between or after', () => {
    expect(trackingLeg('WORKER_EN_ROUTE', true)).toBe('to_pickup');
    expect(trackingLeg('IN_PROGRESS', true)).toBe('to_dropoff');
    for (const status of ['ASSIGNED', 'ARRIVED', 'SUBMITTED', 'UNDER_REVIEW', 'DISPUTED'] as const) {
      expect(trackingLeg(status, true), status).toBeNull();
    }
  });
});
