import { describe, expect, it } from 'vitest';
import { decodeUnverifiedSubject } from './account-aware-throttler.guard';

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature-not-checked`;
}

describe('decodeUnverifiedSubject', () => {
  it('reads sub from a well-formed bearer token, regardless of signature validity', () => {
    const header = `Bearer ${fakeJwt({ sub: 'user-123', platformRole: 'USER' })}`;
    expect(decodeUnverifiedSubject(header)).toBe('user-123');
  });

  it('returns undefined for a missing Authorization header', () => {
    expect(decodeUnverifiedSubject(undefined)).toBeUndefined();
  });

  it('returns undefined for a non-Bearer scheme', () => {
    expect(decodeUnverifiedSubject('Basic dXNlcjpwYXNz')).toBeUndefined();
  });

  it('returns undefined for a malformed token (no payload segment)', () => {
    expect(decodeUnverifiedSubject('Bearer not-a-jwt')).toBeUndefined();
  });

  it('returns undefined for a payload segment that is not valid JSON', () => {
    const garbage = Buffer.from('not json').toString('base64url');
    expect(decodeUnverifiedSubject(`Bearer header.${garbage}.sig`)).toBeUndefined();
  });

  it('returns undefined when the payload has no sub claim', () => {
    const header = `Bearer ${fakeJwt({ platformRole: 'USER' })}`;
    expect(decodeUnverifiedSubject(header)).toBeUndefined();
  });

  it('does not throw on a token with a tampered signature — decoding never checks it', () => {
    const token = fakeJwt({ sub: 'user-456' });
    const tampered = token.slice(0, -3) + 'xyz';
    expect(decodeUnverifiedSubject(`Bearer ${tampered}`)).toBe('user-456');
  });
});
