import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway';

vi.mock('../../config/env', () => ({ loadEnv: () => ({ WEB_URL: 'http://localhost:5173' }) }));

/** docs/22, #22: a socket gets the same checks as an HTTP request, and lives no longer than its token. */
function fakeClient(token: string | undefined) {
  return {
    id: 's1',
    handshake: { auth: { token }, query: {} },
    data: {} as Record<string, unknown>,
    emit: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  };
}

function build(user: { status: string; tokenVersion: number } | null, payload: Record<string, unknown> | Error) {
  const tokens = {
    verifyAccessToken: vi.fn(() => {
      if (payload instanceof Error) throw payload;
      return payload;
    }),
  };
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user) } };
  return new RealtimeGateway(tokens as never, prisma as never, {} as never);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('RealtimeGateway.handleConnection', () => {
  it('admits a current session, and ends it when its token expires, telling the client to refresh', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const gateway = build({ status: 'ACTIVE', tokenVersion: 3 }, { sub: 'u1', tokenVersion: 3, exp });
    const client = fakeClient('t');

    await gateway.handleConnection(client as never);
    expect(client.join).toHaveBeenCalledWith('user:u1');
    expect(client.disconnect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(61_000);
    expect(client.emit).toHaveBeenCalledWith('session:expired', {});
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('refuses a token whose version was bumped (suspension, password reset, deletion)', async () => {
    const gateway = build({ status: 'ACTIVE', tokenVersion: 4 }, { sub: 'u1', tokenVersion: 3 });
    const client = fakeClient('t');

    await gateway.handleConnection(client as never);
    expect(client.emit).toHaveBeenCalledWith('session:revoked', {});
    expect(client.join).not.toHaveBeenCalled();
  });

  it('refuses an account that is not active', async () => {
    const gateway = build({ status: 'SUSPENDED', tokenVersion: 3 }, { sub: 'u1', tokenVersion: 3 });
    const client = fakeClient('t');

    await gateway.handleConnection(client as never);
    expect(client.emit).toHaveBeenCalledWith('session:revoked', {});
  });

  it('tells a client with an expired token to refresh, not to give up', async () => {
    const gateway = build(null, new Error('jwt expired'));
    const client = fakeClient('t');

    await gateway.handleConnection(client as never);
    expect(client.emit).toHaveBeenCalledWith('session:expired', {});
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('clears the expiry timer when the socket goes away first', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const gateway = build({ status: 'ACTIVE', tokenVersion: 1 }, { sub: 'u1', tokenVersion: 1, exp });
    const client = fakeClient('t');

    await gateway.handleConnection(client as never);
    gateway.handleDisconnect(client as never);
    vi.advanceTimersByTime(61_000);
    expect(client.emit).not.toHaveBeenCalled();
  });
});
