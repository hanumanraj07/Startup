import { describe, expect, it, vi } from 'vitest';
import { ChatService } from './chat.service';
import { ForbiddenError } from '../../common/errors';

/**
 * The one property this file exists to guarantee: chat cannot be written to
 * once a task is finished. See CHAT_WRITABLE_STATUSES's own comment in
 * chat.service.ts for why this matters beyond tidiness — it closes a real
 * post-transaction harassment/scam surface, not just a UX nicety.
 */
function fakePrisma(task: Record<string, unknown> | null) {
  return {
    task: { findUnique: vi.fn().mockResolvedValue(task) },
    message: { create: vi.fn().mockResolvedValue({ id: 'm1', taskId: 't1', senderId: 'req-1', redactedBody: 'hi', redactionFlags: [], attachmentKey: null, createdAt: new Date(), readAt: null }) },
  };
}

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    requesterId: 'req-1',
    assignedWorkerId: 'worker-1',
    status: 'IN_PROGRESS',
    ...overrides,
  };
}

function fakeNotifications() {
  return { notify: vi.fn().mockResolvedValue(undefined) };
}

function fakeRealtime() {
  return { emitNewMessage: vi.fn() };
}

describe('ChatService.send — chat closes once the task is finished', () => {
  it('allows sending while the task is active work', async () => {
    const client = fakePrisma(baseTask({ status: 'IN_PROGRESS' }));
    const service = new ChatService(client as never, fakeNotifications() as never, fakeRealtime() as never);

    await expect(service.send('t1', 'req-1', { body: 'On my way' })).resolves.toBeDefined();
    expect(client.message.create).toHaveBeenCalledOnce();
  });

  it('allows sending while awaiting review', async () => {
    const client = fakePrisma(baseTask({ status: 'SUBMITTED' }));
    const service = new ChatService(client as never, fakeNotifications() as never, fakeRealtime() as never);

    await expect(service.send('t1', 'req-1', { body: 'Looks good' })).resolves.toBeDefined();
  });

  it('refuses to send once the task is completed', async () => {
    const client = fakePrisma(baseTask({ status: 'COMPLETED' }));
    const service = new ChatService(client as never, fakeNotifications() as never, fakeRealtime() as never);

    await expect(service.send('t1', 'req-1', { body: 'Are you free tomorrow too?' })).rejects.toThrow(
      ForbiddenError,
    );
    expect(client.message.create).not.toHaveBeenCalled();
  });

  it('refuses to send once the task is cancelled', async () => {
    const client = fakePrisma(baseTask({ status: 'CANCELLED' }));
    const service = new ChatService(client as never, fakeNotifications() as never, fakeRealtime() as never);

    await expect(service.send('t1', 'req-1', { body: 'hey' })).rejects.toThrow(ForbiddenError);
  });

  it('refuses to send while a dispute is open, even though history stays readable elsewhere', async () => {
    const client = fakePrisma(baseTask({ status: 'DISPUTED' }));
    const service = new ChatService(client as never, fakeNotifications() as never, fakeRealtime() as never);

    await expect(service.send('t1', 'req-1', { body: 'please reconsider' })).rejects.toThrow(ForbiddenError);
  });
});
