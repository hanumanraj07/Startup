import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes and verifies the same password', async () => {
    const hash = await service.hash('correct horse battery staple');
    expect(await service.verify(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await service.hash('correct horse battery staple');
    expect(await service.verify(hash, 'wrong password entirely')).toBe(false);
  });

  it('never stores the plaintext in the hash output', async () => {
    const hash = await service.hash('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('produces an argon2id hash, per docs/16-security-requirements.md', async () => {
    const hash = await service.hash('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('salts every hash, so the same password never produces the same hash twice', async () => {
    const [a, b] = await Promise.all([
      service.hash('correct horse battery staple'),
      service.hash('correct horse battery staple'),
    ]);
    expect(a).not.toBe(b);
  });

  it('does not throw on a malformed stored hash, and fails closed', async () => {
    await expect(service.verify('not-a-real-hash', 'anything')).resolves.toBe(false);
  });
}, 20_000);
