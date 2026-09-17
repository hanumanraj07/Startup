import { describe, expect, it } from 'vitest';
import { redactContactInfo } from './redaction';

describe('redactContactInfo', () => {
  it('leaves an ordinary message untouched', () => {
    const result = redactContactInfo('The shop opens at 11am, I will head there now.');
    expect(result.redactedBody).toBe('The shop opens at 11am, I will head there now.');
    expect(result.flags).toEqual([]);
  });

  it('redacts a bare 10-digit Indian mobile number', () => {
    const result = redactContactInfo('Call me on 9876543210 when you arrive');
    expect(result.redactedBody).toBe('Call me on [phone number removed] when you arrive');
    expect(result.flags).toEqual(['phone']);
  });

  it('redacts a +91-prefixed number with separators', () => {
    const result = redactContactInfo('WhatsApp +91 98765-43210 please');
    expect(result.redactedBody).toContain('[phone number removed]');
    expect(result.flags).toContain('phone');
  });

  it('redacts a number written with a leading trunk 0 (found live: this fully bypassed the previous pattern)', () => {
    const result = redactContactInfo('call 08209512102 anytime');
    expect(result.redactedBody).toBe('call [phone number removed] anytime');
    expect(result.flags).toEqual(['phone']);
  });

  it('does not flag a random 10-digit string that is not a valid Indian mobile prefix', () => {
    // Indian mobile numbers start 6-9; a number starting with 1-5 should not match.
    const result = redactContactInfo('Order number 1234567890 confirmed');
    expect(result.redactedBody).toBe('Order number 1234567890 confirmed');
    expect(result.flags).toEqual([]);
  });

  it('redacts a standard email address', () => {
    const result = redactContactInfo('Email me at rahul.sharma@gmail.com for the invoice');
    expect(result.redactedBody).toBe('Email me at [email removed] for the invoice');
    expect(result.flags).toEqual(['email']);
  });

  it('redacts a UPI handle without a dotted domain', () => {
    const result = redactContactInfo('Pay me at rahul@okhdfcbank instead');
    expect(result.redactedBody).toBe('Pay me at [UPI ID removed] instead');
    expect(result.flags).toEqual(['upi']);
  });

  it('redacts a numeric UPI handle', () => {
    const result = redactContactInfo('UPI: 9876543210@ybl');
    expect(result.redactedBody).toContain('[UPI ID removed]');
    expect(result.flags).toContain('upi');
  });

  it('does not double-flag an email address as a UPI handle', () => {
    const result = redactContactInfo('rahul.sharma@gmail.com');
    expect(result.redactedBody).toBe('[email removed]');
    expect(result.flags).toEqual(['email']);
  });

  it('redacts multiple distinct kinds of contact info in one message', () => {
    const result = redactContactInfo('Reach me at 9876543210 or rahul@gmail.com, UPI is rahul@okaxis');
    expect(result.redactedBody).not.toMatch(/9876543210|rahul@gmail\.com|rahul@okaxis/);
    expect(result.flags).toEqual(expect.arrayContaining(['phone', 'email', 'upi']));
  });

  it('is not corrupted by shared regex state across successive calls (lastIndex safety)', () => {
    // A first call that matches near the END of a long string could leave a
    // naive .test()-then-.replace() implementation with a nonzero lastIndex.
    const first = redactContactInfo('x'.repeat(200) + ' call 9876543210');
    expect(first.flags).toContain('phone');

    // A second, unrelated, SHORT string whose match is near the START would
    // be missed by a regex whose lastIndex was left pointing past position 0.
    const second = redactContactInfo('9876543210 call me');
    expect(second.redactedBody).toBe('[phone number removed] call me');
    expect(second.flags).toContain('phone');
  });

  it('handles an empty string without throwing', () => {
    expect(redactContactInfo('')).toEqual({ redactedBody: '', flags: [] });
  });
});
