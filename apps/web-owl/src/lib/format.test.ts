import { describe, expect, it } from 'vitest';
import { formatMemberSince, hoursLeft, radiusKm } from './format';

const NOW = Date.parse('2026-10-10T12:00:00Z');

describe('hoursLeft', () => {
  it('rounds to the nearest whole hour', () => {
    expect(hoursLeft('2026-10-10T17:00:00Z', NOW)).toBe(5);
    expect(hoursLeft('2026-10-10T17:29:00Z', NOW)).toBe(5);
    expect(hoursLeft('2026-10-10T17:31:00Z', NOW)).toBe(6);
  });

  it('is zero, never negative, once the deadline has passed', () => {
    expect(hoursLeft('2026-10-10T08:00:00Z', NOW)).toBe(0);
  });
});

describe('radiusKm', () => {
  it('converts metres to whole kilometres', () => {
    expect(radiusKm(15_000)).toBe('15');
    expect(radiusKm(7_500)).toBe('8');
  });
});

describe('formatMemberSince', () => {
  it('includes the year', () => {
    expect(formatMemberSince('2026-09-16T10:00:00Z')).toMatch(/2026/);
  });
});
