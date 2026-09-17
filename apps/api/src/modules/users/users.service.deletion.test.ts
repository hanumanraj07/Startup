import { describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../common/errors';

/**
 * The one property that actually matters for account deletion, safety-wise:
 * you cannot delete your way out of a task you're still on the hook for.
 * Without this, deleting an account would be a way to abandon an in-progress
 * task or dodge a dispute a moment before it's raised — exactly the kind of
 * gap docs/16-security-requirements.md exists to close.
 */
function fakePrisma(user: Record<string, unknown> | null, activeTaskCount: number) {
  const update = vi.fn().mockResolvedValue({});
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const updateMany = vi.fn().mockResolvedValue({ count: 0 });

  const client = {
    user: { findUnique: vi.fn().mockResolvedValue(user), update },
    task: {
      // Both the requester-side and worker-side counts are called; either
      // returning > 0 must block deletion, so route both through the same
      // configurable count for this test's purposes.
      count: vi.fn().mockResolvedValue(activeTaskCount),
    },
    refreshToken: { deleteMany },
    pushSubscription: { deleteMany },
    workerProfile: { updateMany },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return { client, update, deleteMany };
}

function fakePasswords(verifies: boolean) {
  return { verify: vi.fn().mockResolvedValue(verifies) };
}

function fakeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

const BASE_USER = { id: 'u1', passwordHash: null as string | null };

describe('UsersService.deleteAccount', () => {
  it('refuses when the user has a task still in progress, as requester or worker', async () => {
    const { client } = fakePrisma(BASE_USER, 1);
    const service = new UsersService(client as never, {} as never, fakePasswords(true) as never, fakeAudit() as never);

    await expect(service.deleteAccount('u1', { confirm: 'DELETE' })).rejects.toThrow(BusinessRuleError);
    expect(client.user.update).not.toHaveBeenCalled();
  });

  it('requires the correct password when the account has one', async () => {
    const { client } = fakePrisma({ ...BASE_USER, passwordHash: 'hash' }, 0);
    const passwords = fakePasswords(false);
    const service = new UsersService(client as never, {} as never, passwords as never, fakeAudit() as never);

    await expect(service.deleteAccount('u1', { confirm: 'DELETE', password: 'wrong' })).rejects.toThrow(
      ForbiddenError,
    );
    expect(client.user.update).not.toHaveBeenCalled();
  });

  it('refuses with no password given at all when the account has one', async () => {
    const { client } = fakePrisma({ ...BASE_USER, passwordHash: 'hash' }, 0);
    const service = new UsersService(client as never, {} as never, fakePasswords(true) as never, fakeAudit() as never);

    await expect(service.deleteAccount('u1', { confirm: 'DELETE' })).rejects.toThrow(ForbiddenError);
  });

  it('does not require a password for a Google-only account', async () => {
    const { client, update } = fakePrisma({ ...BASE_USER, passwordHash: null }, 0);
    const service = new UsersService(client as never, {} as never, fakePasswords(true) as never, fakeAudit() as never);

    const result = await service.deleteAccount('u1', { confirm: 'DELETE' });

    expect(result).toEqual({ success: true });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('anonymizes every identifying field and bumps tokenVersion to invalidate existing sessions', async () => {
    const { client, update } = fakePrisma({ ...BASE_USER, passwordHash: 'hash' }, 0);
    const service = new UsersService(client as never, {} as never, fakePasswords(true) as never, fakeAudit() as never);

    await service.deleteAccount('u1', { confirm: 'DELETE', password: 'correct' });

    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('DELETED');
    expect(data.phone).toBeNull();
    expect(data.passwordHash).toBeNull();
    expect(data.googleId).toBeNull();
    expect(data.displayName).toBe('Deleted user');
    expect(data.homeAddress).toBeNull();
    expect(data.email).toMatch(/^deleted-.+@deleted\.onsite\.local$/);
    expect(data.tokenVersion).toEqual({ increment: 1 });
  });

  it('rejects a user id that does not exist', async () => {
    const { client } = fakePrisma(null, 0);
    const service = new UsersService(client as never, {} as never, fakePasswords(true) as never, fakeAudit() as never);

    await expect(service.deleteAccount('missing', { confirm: 'DELETE' })).rejects.toThrow(NotFoundError);
  });
});
