import { describe, expect, it } from 'vitest';
import {
  CHAT_VISIBLE_STATUSES,
  CHAT_WRITABLE_STATUSES,
  LEAVABLE_STATUSES,
  PROOF_VISIBLE_STATUSES,
  REPORTABLE_STATUSES,
  WORKER_REMOVABLE_STATUSES,
} from './task-status';

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

  it('lets a worker leave until submission, and a requester remove them only before arrival', () => {
    expect(LEAVABLE_STATUSES).toContain('IN_PROGRESS');
    expect(LEAVABLE_STATUSES).not.toContain('SUBMITTED');
    expect(WORKER_REMOVABLE_STATUSES).toEqual(['ASSIGNED', 'WORKER_EN_ROUTE']);
    for (const status of WORKER_REMOVABLE_STATUSES) expect(LEAVABLE_STATUSES).toContain(status);
  });
});
