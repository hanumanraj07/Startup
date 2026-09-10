import { describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { toPublicUser, toPublicWorker, toSelfUser } from './projections';

/**
 * A "kitchen sink" fake row carrying every sensitive field the User model
 * has, so a projection leaking one shows up as an unexpected key in the
 * exact-key-set assertion rather than requiring someone to remember to test
 * for that one field. Same pattern as tasks.service.pii.test.ts.
 */
const KITCHEN_SINK_USER: User = {
  id: 'u1',
  email: 'requester@example.com',
  emailVerifiedAt: new Date('2026-01-01'),
  phone: '+919876543210',
  phoneVerifiedAt: new Date('2026-01-02'),
  passwordHash: '$argon2id$v=19$m=1,t=1,p=1$AAAAAAAAAAAAAAAA$AA',
  googleId: 'google-oauth-id-123',
  displayName: 'Rahul Sharma',
  avatarUrl: 'https://cdn.example.com/avatar.jpg',
  homeCity: 'Ahmedabad',
  homeAddress: '221B Baker Colony, Ahmedabad',
  homeLat: 23.0225,
  homeLng: 72.5714,
  verificationLevel: 2,
  platformRole: 'USER',
  status: 'ACTIVE',
  suspendedReason: null,
  tokenVersion: 0,
  notificationPrefs: null,
  createdAt: new Date('2025-06-01'),
  updatedAt: new Date('2026-01-02'),
} as User;

const SENSITIVE_VALUES = [
  KITCHEN_SINK_USER.email,
  KITCHEN_SINK_USER.phone,
  KITCHEN_SINK_USER.passwordHash,
  KITCHEN_SINK_USER.googleId,
  KITCHEN_SINK_USER.homeAddress,
  String(KITCHEN_SINK_USER.homeLat),
  String(KITCHEN_SINK_USER.homeLng),
];

describe('toPublicUser', () => {
  it('exposes exactly the public key set, nothing private', () => {
    const result = toPublicUser(KITCHEN_SINK_USER);
    expect(Object.keys(result).sort()).toEqual(
      ['id', 'displayName', 'avatarUrl', 'homeCity', 'verificationLevel', 'memberSince'].sort(),
    );
  });

  it('never serializes email, phone, password, google id, home address or coordinates', () => {
    const serialized = JSON.stringify(toPublicUser(KITCHEN_SINK_USER));
    for (const value of SENSITIVE_VALUES) {
      expect(serialized).not.toContain(value);
    }
  });
});

describe('toPublicWorker', () => {
  const workerStats = { ratingAvg: 4.8, ratingCount: 132, tasksCompleted: 140, completionRate: 0.96 };

  it('exposes exactly PublicUser plus the trust-page figures, nothing private', () => {
    const result = toPublicWorker(KITCHEN_SINK_USER, workerStats);
    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'displayName',
        'avatarUrl',
        'homeCity',
        'verificationLevel',
        'memberSince',
        'ratingAvg',
        'ratingCount',
        'tasksCompleted',
        'completionRate',
      ].sort(),
    );
  });

  it('never serializes email, phone, password, google id, home address or coordinates', () => {
    const serialized = JSON.stringify(toPublicWorker(KITCHEN_SINK_USER, workerStats));
    for (const value of SENSITIVE_VALUES) {
      expect(serialized).not.toContain(value);
    }
  });
});

describe('toSelfUser', () => {
  it('adds only the self-view fields on top of PublicUser', () => {
    const result = toSelfUser({ ...KITCHEN_SINK_USER, workerProfile: { id: 'wp1' } });
    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'displayName',
        'avatarUrl',
        'homeCity',
        'verificationLevel',
        'memberSince',
        'email',
        'emailVerified',
        'phone',
        'phoneVerified',
        'platformRole',
        'status',
        'hasWorkerProfile',
      ].sort(),
    );
  });

  it('never serializes the password hash, google id, home address or coordinates', () => {
    const serialized = JSON.stringify(toSelfUser({ ...KITCHEN_SINK_USER, workerProfile: null }));
    expect(serialized).not.toContain(KITCHEN_SINK_USER.passwordHash);
    expect(serialized).not.toContain(KITCHEN_SINK_USER.googleId);
    expect(serialized).not.toContain(KITCHEN_SINK_USER.homeAddress);
    expect(serialized).not.toContain(String(KITCHEN_SINK_USER.homeLat));
  });
});
