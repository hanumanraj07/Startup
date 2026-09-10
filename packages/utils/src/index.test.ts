import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  formatDistance,
  formatTimeRemaining,
  initials,
  maskTail,
  redactContactDetails,
  truncate,
} from './index';

describe('formatDistance', () => {
  it('uses metres below a kilometre', () => {
    expect(formatDistance(380)).toBe('380 m');
  });

  it('uses one decimal for short kilometre distances', () => {
    expect(formatDistance(2_400)).toBe('2.4 km');
  });

  it('drops the decimal beyond 10 km', () => {
    expect(formatDistance(14_800)).toBe('15 km');
  });

  it('handles invalid input without throwing', () => {
    expect(formatDistance(Number.NaN)).toBe('—');
    expect(formatDistance(-5)).toBe('—');
  });
});

describe('formatTimeRemaining', () => {
  const now = new Date('2026-09-07T10:00:00Z');

  it('reports minutes under an hour', () => {
    expect(formatTimeRemaining(new Date('2026-09-07T10:45:00Z'), now)).toBe('45 min left');
  });

  it('reports hours and minutes within a day', () => {
    expect(formatTimeRemaining(new Date('2026-09-07T18:00:00Z'), now)).toBe('8h left');
    expect(formatTimeRemaining(new Date('2026-09-07T18:30:00Z'), now)).toBe('8h 30m left');
  });

  it('reports days beyond a day', () => {
    expect(formatTimeRemaining(new Date('2026-09-09T10:00:00Z'), now)).toBe('2 days left');
  });

  it('reports overdue rather than a negative time', () => {
    expect(formatTimeRemaining(new Date('2026-09-07T09:00:00Z'), now)).toBe('Overdue');
  });
});

describe('redactContactDetails — this protects workers, so it must be thorough', () => {
  it('redacts a bare ten-digit mobile number', () => {
    const r = redactContactDetails('call me on 9876543210');
    expect(r.redacted).not.toContain('9876543210');
    expect(r.flags).toContain('phone');
  });

  it('redacts spaced and hyphenated numbers', () => {
    expect(redactContactDetails('98765 43210').flags).toContain('phone');
    expect(redactContactDetails('98765-43210').flags).toContain('phone');
    expect(redactContactDetails('+91 98765 43210').flags).toContain('phone');
  });

  it('redacts email addresses', () => {
    const r = redactContactDetails('mail me at rahul@example.com');
    expect(r.redacted).not.toContain('rahul@example.com');
    expect(r.flags).toContain('email');
  });

  it('redacts UPI identifiers', () => {
    const r = redactContactDetails('pay me at rahul@ybl');
    expect(r.redacted).not.toContain('rahul@ybl');
    expect(r.flags).toContain('upi');
  });

  it('redacts links', () => {
    const r = redactContactDetails('see https://wa.me/919876543210');
    expect(r.redacted).not.toContain('wa.me');
    expect(r.flags).toContain('url');
  });

  it('leaves ordinary messages untouched', () => {
    const body = 'I am at the store now, the model is available';
    expect(redactContactDetails(body).redacted).toBe(body);
    expect(redactContactDetails(body).flags).toHaveLength(0);
  });

  it('does not redact prices or product numbers, which appear constantly', () => {
    // False positives here would break the core inspection use case.
    const body = 'MacBook Air M4 16/512 is ₹114900, serial C02X1234JGH5';
    const r = redactContactDetails(body);
    expect(r.redacted).toContain('114900');
    expect(r.redacted).toContain('C02X1234JGH5');
    expect(r.flags).toHaveLength(0);
  });

  it('handles several contact details in one message', () => {
    const r = redactContactDetails('9876543210 or rahul@example.com or rahul@paytm');
    expect(r.flags).toEqual(expect.arrayContaining(['phone', 'email', 'upi']));
  });
});

describe('cursors', () => {
  it('round-trips', () => {
    const payload = { id: 'abc-123', createdAt: 1_757_000_000_000 };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('returns null for a malformed cursor rather than throwing', () => {
    expect(decodeCursor('not-a-cursor!!')).toBeNull();
  });

  it('produces URL-safe output', () => {
    const cursor = encodeCursor({ id: 'a'.repeat(40), n: 999 });
    expect(cursor).not.toMatch(/[+/=]/);
  });
});

describe('text helpers', () => {
  it('builds initials from one or two names', () => {
    expect(initials('Rahul Sharma')).toBe('RS');
    expect(initials('Rahul')).toBe('R');
    expect(initials('   ')).toBe('?');
  });

  it('truncates with an ellipsis', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('abc', 5)).toBe('abc');
  });

  it('masks all but the tail', () => {
    expect(maskTail('123456789012')).toBe('••••••••9012');
  });
});
