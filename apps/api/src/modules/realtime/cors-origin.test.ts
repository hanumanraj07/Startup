import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from './cors-origin';

const WEB_URL = 'https://onsite.example.com';

describe('isAllowedOrigin', () => {
  it('allows the configured web origin', () => {
    expect(isAllowedOrigin(WEB_URL, WEB_URL)).toBe(true);
  });

  it('allows a missing origin (same-origin or non-browser client)', () => {
    expect(isAllowedOrigin(undefined, WEB_URL)).toBe(true);
  });

  it('rejects an arbitrary third-party origin', () => {
    expect(isAllowedOrigin('https://evil.example.com', WEB_URL)).toBe(false);
  });

  it('rejects a similar-looking but different origin (subdomain, different scheme, trailing slash)', () => {
    expect(isAllowedOrigin('https://sub.onsite.example.com', WEB_URL)).toBe(false);
    expect(isAllowedOrigin('http://onsite.example.com', WEB_URL)).toBe(false);
    expect(isAllowedOrigin('https://onsite.example.com/', WEB_URL)).toBe(false);
  });
});
