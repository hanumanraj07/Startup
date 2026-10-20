import { describe, expect, it, vi } from 'vitest';
import { MAX_DELIVERY_ATTEMPTS, NotificationService } from './notification.service';

/** docs/22, #17: notify never waits on a provider; delivery sends each channel at most once, with retries. */

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    userId: 'u1',
    type: 'WORKER_ASSIGNED',
    title: 'A worker accepted',
    body: 'Ravi is on it',
    pendingChannels: ['PUSH', 'EMAIL'],
    pushSentAt: null,
    emailSentAt: null,
    deliveryAttempts: 1,
    ...overrides,
  };
}

function build(options: { claim?: number; row?: ReturnType<typeof row>; emailFails?: boolean } = {}) {
  const update = vi.fn().mockResolvedValue({});
  const prisma = {
    notification: {
      create: vi.fn().mockResolvedValue({ id: 'n1' }),
      updateMany: vi.fn().mockResolvedValue({ count: options.claim ?? 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(options.row ?? row()),
      findMany: vi.fn().mockResolvedValue([]),
      update,
    },
    user: { findUnique: vi.fn().mockResolvedValue({ email: 'u1@example.com', notificationPrefs: null }) },
  };
  const push = { sendToUser: vi.fn().mockResolvedValue({ sent: 1 }) };
  const email = {
    send: options.emailFails ? vi.fn().mockRejectedValue(new Error('SMTP timeout')) : vi.fn().mockResolvedValue(undefined),
  };
  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const service = new NotificationService(prisma as never, push as never, email as never, queue as never);
  return { service, prisma, push, email, queue, update };
}

describe('NotificationService.notify', () => {
  it('writes the in-app row with the channels still to send, queues them, and sends nothing itself', async () => {
    const { service, prisma, push, email, queue } = build();

    await service.notify('u1', { event: 'WORKER_ASSIGNED', taskId: 't1', taskTitle: 'Check a shop', workerName: 'Ravi' });

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', type: 'WORKER_ASSIGNED', deliveredAt: null }) }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith('n1');
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });
});

describe('NotificationService.deliver', () => {
  it('sends push and email and marks the row delivered', async () => {
    const { service, push, email, update } = build();

    expect(await service.deliver('n1')).toBe('DONE');
    expect(push.sendToUser).toHaveBeenCalledOnce();
    expect(email.send).toHaveBeenCalledWith({ to: 'u1@example.com', subject: 'A worker accepted', body: 'Ravi is on it' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deliveredAt: expect.any(Date), deliveryError: null }) }),
    );
  });

  it('asks for a retry when email fails, keeping the push it already sent', async () => {
    const { service, update } = build({ emailFails: true });

    expect(await service.deliver('n1')).toBe('RETRY');
    const data = update.mock.calls[0]?.[0].data;
    expect(data.pushSentAt).toBeInstanceOf(Date);
    expect(data.deliveredAt).toBeUndefined();
    expect(data.deliveryError).toContain('SMTP timeout');
  });

  it('on the retry, sends only what is still unsent', async () => {
    const { service, push, email } = build({ row: row({ pushSentAt: new Date(), deliveryAttempts: 2 }) });

    expect(await service.deliver('n1')).toBe('DONE');
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledOnce();
  });

  it('gives up after the last attempt and records why, rather than retrying forever', async () => {
    const { service, update } = build({ emailFails: true, row: row({ pushSentAt: new Date(), deliveryAttempts: MAX_DELIVERY_ATTEMPTS }) });

    expect(await service.deliver('n1')).toBe('DONE');
    expect(update.mock.calls[0]?.[0].data.deliveredAt).toBeInstanceOf(Date);
  });

  it('backs off when another deliverer holds the claim', async () => {
    const { service, push, email } = build({ claim: 0 });

    expect(await service.deliver('n1')).toBe('SKIPPED');
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });
});
