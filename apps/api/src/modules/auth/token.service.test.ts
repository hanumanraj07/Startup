import { beforeEach, describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';
import { resetEnvCache } from '../../config/env';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://onsite:onsite@localhost:5432/onsite_app',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_BUCKET: 'onsite-media',
  STORAGE_ACCESS_KEY: 'x',
  STORAGE_SECRET_KEY: 'y',
};

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(() => {
    resetEnvCache();
    process.env = { ...process.env, ...BASE_ENV };
    service = new TokenService(new JwtService());
  });

  describe('access tokens', () => {
    it('round-trips a payload', () => {
      const token = service.signAccessToken({ sub: 'user-1', platformRole: 'USER', tokenVersion: 0 });
      const payload = service.verifyAccessToken(token);
      expect(payload.sub).toBe('user-1');
      expect(payload.platformRole).toBe('USER');
      expect(payload.tokenVersion).toBe(0);
    });

    it('rejects a token signed with a different secret', () => {
      const token = service.signAccessToken({ sub: 'user-1', platformRole: 'USER', tokenVersion: 0 });

      resetEnvCache();
      process.env = { ...process.env, ...BASE_ENV, JWT_ACCESS_SECRET: 'c'.repeat(32) };
      const otherService = new TokenService(new JwtService());

      expect(() => otherService.verifyAccessToken(token)).toThrow();
    });

    it('rejects a tampered token', () => {
      const token = service.signAccessToken({ sub: 'user-1', platformRole: 'USER', tokenVersion: 0 });
      const tampered = token.slice(0, -2) + (token.at(-2) === 'a' ? 'b' : 'a') + token.at(-1);
      expect(() => service.verifyAccessToken(tampered)).toThrow();
    });
  });

  describe('refresh tokens', () => {
    it('generates tokens with high entropy and a consistent hash', () => {
      const { token, tokenHash } = service.generateRefreshToken();
      expect(token.length).toBeGreaterThan(40);
      expect(tokenHash).toBe(service.hashOpaqueToken(token));
    });

    it('never reuses a token across calls', () => {
      const a = service.generateRefreshToken();
      const b = service.generateRefreshToken();
      expect(a.token).not.toBe(b.token);
      expect(a.tokenHash).not.toBe(b.tokenHash);
    });

    it('hashes deterministically, so a lookup by hash actually works', () => {
      const raw = 'a-fixed-refresh-token-value';
      expect(service.hashOpaqueToken(raw)).toBe(service.hashOpaqueToken(raw));
    });
  });

  describe('constantTimeEqual', () => {
    it('matches equal strings', () => {
      expect(service.constantTimeEqual('abc123', 'abc123')).toBe(true);
    });

    it('rejects different strings, including different lengths', () => {
      expect(service.constantTimeEqual('abc123', 'abc124')).toBe(false);
      expect(service.constantTimeEqual('abc', 'abcd')).toBe(false);
    });
  });

  describe('link tokens — used for email verification and password reset', () => {
    it('packs and unpacks a row id and secret', () => {
      const packed = service.packLinkToken('row-id-123', 'the-secret-value');
      const unpacked = service.unpackLinkToken(packed);
      expect(unpacked).toEqual({ rowId: 'row-id-123', secret: 'the-secret-value' });
    });

    it('handles a secret that itself contains a dot', () => {
      // base64url never contains '.', but the parser should not assume that;
      // it must split on the FIRST dot only, or a secret with one would break.
      const packed = service.packLinkToken('row-id', 'sec.ret');
      expect(service.unpackLinkToken(packed)).toEqual({ rowId: 'row-id', secret: 'sec.ret' });
    });

    it('rejects a token with no separator', () => {
      expect(service.unpackLinkToken('no-separator-here')).toBeNull();
    });

    it('rejects a token with an empty row id or empty secret', () => {
      expect(service.unpackLinkToken('.secret')).toBeNull();
      expect(service.unpackLinkToken('rowid.')).toBeNull();
    });

    it('generates link secrets with real entropy and no collisions across many calls', () => {
      const secrets = new Set(Array.from({ length: 200 }, () => service.generateLinkSecret()));
      expect(secrets.size).toBe(200);
    });
  });

  describe('numeric OTPs', () => {
    it('generates codes of the requested length, zero-padded', () => {
      for (let i = 0; i < 50; i += 1) {
        expect(service.generateNumericOtp()).toMatch(/^\d{6}$/);
      }
    });

    it('supports a different digit count', () => {
      expect(service.generateNumericOtp(4)).toMatch(/^\d{4}$/);
    });

    it('is not the same code every time', () => {
      const codes = new Set(Array.from({ length: 30 }, () => service.generateNumericOtp()));
      expect(codes.size).toBeGreaterThan(1);
    });
  });
});
