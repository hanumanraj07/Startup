import { describe, expect, it } from 'vitest';
import { RealtimePublisher } from './realtime.publisher';

/**
 * docs/22, #1: a broadcast that threw in the worker process skipped the
 * refund after it. Every caller now relies on the publisher never throwing.
 */
describe('RealtimePublisher never throws', () => {
  function brokenPublisher() {
    const publisher = new RealtimePublisher();
    const boom = () => {
      throw new Error('Redis unavailable');
    };
    (publisher as unknown as { emitter: unknown }).emitter = { to: boom, in: boom };
    return publisher;
  }

  it('swallows a failed status broadcast', () => {
    expect(() => brokenPublisher().taskStatus('t1', 'EXPIRED')).not.toThrow();
  });

  it('swallows a failed chat broadcast', () => {
    expect(() => brokenPublisher().newMessage('t1', { id: 'm1' })).not.toThrow();
  });

  it('swallows a failed room removal', () => {
    expect(() => brokenPublisher().removeUserFromTask('t1', 'u1')).not.toThrow();
  });
});
