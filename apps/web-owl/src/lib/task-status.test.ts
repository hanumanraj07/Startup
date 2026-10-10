import { describe, expect, it } from 'vitest';
import { CHAT_VISIBLE_STATUSES, CHAT_WRITABLE_STATUSES, PROOF_VISIBLE_STATUSES, REPORTABLE_STATUSES } from './task-status';

describe('task status sets', () => {
  it('only lets people write in chats they can also read', () => {
    for (const status of CHAT_WRITABLE_STATUSES) expect(CHAT_VISIBLE_STATUSES).toContain(status);
  });

  it('never exposes chat or reporting before a worker is assigned', () => {
    for (const status of ['DRAFT', 'PUBLISHED', 'MATCHING', 'CANCELLED', 'EXPIRED'] as const) {
      expect(CHAT_VISIBLE_STATUSES).not.toContain(status);
      expect(REPORTABLE_STATUSES).not.toContain(status);
    }
  });

  it('closes chat once a task is finished but still lets it be reported after completion', () => {
    expect(CHAT_WRITABLE_STATUSES).not.toContain('COMPLETED');
    expect(CHAT_VISIBLE_STATUSES).toContain('COMPLETED');
    expect(REPORTABLE_STATUSES).toContain('COMPLETED');
  });

  it('does not offer to report a task that is already disputed or paid out', () => {
    expect(REPORTABLE_STATUSES).not.toContain('DISPUTED');
    expect(REPORTABLE_STATUSES).not.toContain('PAYMENT_RELEASED');
  });

  it('shows proofs from arrival onward and not before', () => {
    expect(PROOF_VISIBLE_STATUSES).toContain('ARRIVED');
    expect(PROOF_VISIBLE_STATUSES).not.toContain('ASSIGNED');
    expect(PROOF_VISIBLE_STATUSES).not.toContain('WORKER_EN_ROUTE');
  });
});
