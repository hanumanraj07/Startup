import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '@prisma/client';
import {
  assertTransitionAllowed,
  availableTransitions,
  checkTransition,
  isTerminal,
  TERMINAL_STATUSES,
  TRANSITION_RULES,
} from './transitions';
import { IllegalTransitionError } from '../../common/errors';

const ALL_STATUSES: TaskStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'MATCHING',
  'ASSIGNED',
  'WORKER_EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'COMPLETED',
  'PAYMENT_RELEASED',
  'DISPUTED',
  'CANCELLED',
  'EXPIRED',
];

const allowed = (
  from: TaskStatus,
  to: TaskStatus,
  actor: Parameters<typeof checkTransition>[2],
  ctx: Parameters<typeof checkTransition>[3] = {},
) => checkTransition(from, to, actor, ctx).allowed;

describe('the happy path, end to end', () => {
  it('walks the full lifecycle from draft to payment released', () => {
    expect(allowed('DRAFT', 'PUBLISHED', 'REQUESTER', { paymentCaptured: true })).toBe(true);
    expect(allowed('PUBLISHED', 'MATCHING', 'SYSTEM')).toBe(true);
    expect(allowed('MATCHING', 'ASSIGNED', 'WORKER', { hasAssignedWorker: false })).toBe(true);
    expect(allowed('ASSIGNED', 'WORKER_EN_ROUTE', 'WORKER', { isAssignedWorker: true })).toBe(true);
    expect(allowed('WORKER_EN_ROUTE', 'ARRIVED', 'WORKER', { isAssignedWorker: true })).toBe(true);
    expect(allowed('ARRIVED', 'IN_PROGRESS', 'WORKER', { isAssignedWorker: true })).toBe(true);
    expect(
      allowed('IN_PROGRESS', 'SUBMITTED', 'WORKER', {
        isAssignedWorker: true,
        proofRequirementsMet: true,
      }),
    ).toBe(true);
    expect(allowed('SUBMITTED', 'COMPLETED', 'REQUESTER')).toBe(true);
    expect(allowed('COMPLETED', 'PAYMENT_RELEASED', 'SYSTEM')).toBe(true);
  });
});

describe('the publication gate — no task is visible before funds are captured', () => {
  it('publishes when payment is captured', () => {
    expect(allowed('DRAFT', 'PUBLISHED', 'REQUESTER', { paymentCaptured: true })).toBe(true);
  });

  it('REFUSES to publish without captured payment', () => {
    // This is the gate that makes the escrow promise real. A task no worker can
    // be paid for must never appear in a feed.
    expect(allowed('DRAFT', 'PUBLISHED', 'REQUESTER', { paymentCaptured: false })).toBe(false);
  });

  it('refuses to publish when payment state is simply unknown', () => {
    expect(allowed('DRAFT', 'PUBLISHED', 'REQUESTER', {})).toBe(false);
  });

  it('does not let a worker publish a task, however the payment stands', () => {
    expect(allowed('DRAFT', 'PUBLISHED', 'WORKER', { paymentCaptured: true })).toBe(false);
  });
});

describe('acceptance', () => {
  it('allows a worker to accept an unassigned task', () => {
    expect(allowed('MATCHING', 'ASSIGNED', 'WORKER', { hasAssignedWorker: false })).toBe(true);
  });

  it('refuses acceptance when the task already has a worker', () => {
    expect(allowed('MATCHING', 'ASSIGNED', 'WORKER', { hasAssignedWorker: true })).toBe(false);
  });

  it('does not let a requester assign a task to a worker directly', () => {
    // Workers must choose. Assigned work nobody agreed to loses supply fastest.
    expect(allowed('MATCHING', 'ASSIGNED', 'REQUESTER', { hasAssignedWorker: false })).toBe(false);
  });
});

describe('execution is restricted to the assigned worker', () => {
  it.each([
    ['ASSIGNED', 'WORKER_EN_ROUTE'],
    ['WORKER_EN_ROUTE', 'ARRIVED'],
    ['ARRIVED', 'IN_PROGRESS'],
  ] as [TaskStatus, TaskStatus][])('%s → %s requires being the assignee', (from, to) => {
    expect(allowed(from, to, 'WORKER', { isAssignedWorker: true })).toBe(true);
    expect(allowed(from, to, 'WORKER', { isAssignedWorker: false })).toBe(false);
  });
});

describe('submission is validated, not asserted', () => {
  it('submits when every required proof is present', () => {
    expect(
      allowed('IN_PROGRESS', 'SUBMITTED', 'WORKER', {
        isAssignedWorker: true,
        proofRequirementsMet: true,
      }),
    ).toBe(true);
  });

  it('REFUSES to submit with missing required proof', () => {
    expect(
      allowed('IN_PROGRESS', 'SUBMITTED', 'WORKER', {
        isAssignedWorker: true,
        proofRequirementsMet: false,
      }),
    ).toBe(false);
  });

  it('refuses submission by someone who is not the assignee', () => {
    expect(
      allowed('IN_PROGRESS', 'SUBMITTED', 'WORKER', {
        isAssignedWorker: false,
        proofRequirementsMet: true,
      }),
    ).toBe(false);
  });
});

describe('a dispute freezes payment — the race that must not be lost', () => {
  it('allows approval when no dispute is open', () => {
    expect(allowed('SUBMITTED', 'COMPLETED', 'REQUESTER', { hasOpenDispute: false })).toBe(true);
  });

  it('BLOCKS requester approval while a dispute is open', () => {
    expect(allowed('SUBMITTED', 'COMPLETED', 'REQUESTER', { hasOpenDispute: true })).toBe(false);
  });

  it('BLOCKS automatic approval while a dispute is open', () => {
    // A dispute raised one second before the 24-hour deadline must win. The
    // sweeper and the queued job both evaluate this guard inside the same
    // transaction as the release.
    expect(allowed('SUBMITTED', 'COMPLETED', 'SYSTEM', { hasOpenDispute: true })).toBe(false);
    expect(allowed('UNDER_REVIEW', 'COMPLETED', 'SYSTEM', { hasOpenDispute: true })).toBe(false);
  });

  it('lets either party raise a dispute after submission', () => {
    expect(allowed('SUBMITTED', 'DISPUTED', 'REQUESTER')).toBe(true);
    expect(allowed('SUBMITTED', 'DISPUTED', 'WORKER')).toBe(true);
  });

  it('lets only an admin resolve a dispute', () => {
    expect(allowed('DISPUTED', 'COMPLETED', 'ADMIN')).toBe(true);
    expect(allowed('DISPUTED', 'CANCELLED', 'ADMIN')).toBe(true);
    expect(allowed('DISPUTED', 'COMPLETED', 'REQUESTER')).toBe(false);
    expect(allowed('DISPUTED', 'COMPLETED', 'WORKER')).toBe(false);
    expect(allowed('DISPUTED', 'CANCELLED', 'REQUESTER')).toBe(false);
  });
});

describe('nobody can release their own money', () => {
  it('does not let a worker approve their own submission', () => {
    expect(allowed('SUBMITTED', 'COMPLETED', 'WORKER')).toBe(false);
    expect(allowed('UNDER_REVIEW', 'COMPLETED', 'WORKER')).toBe(false);
  });

  it('does not let a requester or worker mark payment released', () => {
    expect(allowed('COMPLETED', 'PAYMENT_RELEASED', 'REQUESTER')).toBe(false);
    expect(allowed('COMPLETED', 'PAYMENT_RELEASED', 'WORKER')).toBe(false);
  });

  it('does not let a worker expire a task to force a refund', () => {
    expect(allowed('MATCHING', 'EXPIRED', 'WORKER')).toBe(false);
    expect(allowed('MATCHING', 'EXPIRED', 'REQUESTER')).toBe(false);
    expect(allowed('MATCHING', 'EXPIRED', 'SYSTEM')).toBe(true);
  });
});

describe('terminal states are terminal', () => {
  it.each(TERMINAL_STATUSES)('%s permits no transition, for any actor', (terminal) => {
    for (const to of ALL_STATUSES) {
      for (const actor of ['REQUESTER', 'WORKER', 'ADMIN', 'SYSTEM'] as const) {
        expect(allowed(terminal, to, actor, {})).toBe(false);
      }
    }
  });

  it('reports terminal states correctly', () => {
    expect(isTerminal('PAYMENT_RELEASED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('EXPIRED')).toBe(true);
    expect(isTerminal('SUBMITTED')).toBe(false);
  });
});

describe('illegal transitions are rejected — the larger and more important half', () => {
  it('never allows skipping straight from draft to completed', () => {
    for (const actor of ['REQUESTER', 'WORKER', 'ADMIN', 'SYSTEM'] as const) {
      expect(allowed('DRAFT', 'COMPLETED', actor, { paymentCaptured: true })).toBe(false);
      expect(allowed('DRAFT', 'PAYMENT_RELEASED', actor, {})).toBe(false);
    }
  });

  it('never allows going backwards through the work stages', () => {
    expect(allowed('ARRIVED', 'WORKER_EN_ROUTE', 'WORKER', { isAssignedWorker: true })).toBe(false);
    expect(allowed('SUBMITTED', 'ARRIVED', 'WORKER', { isAssignedWorker: true })).toBe(false);
    expect(allowed('COMPLETED', 'SUBMITTED', 'REQUESTER')).toBe(false);
  });

  it('rejects a transition to the same status', () => {
    for (const status of ALL_STATUSES) {
      expect(allowed(status, status, 'ADMIN', {})).toBe(false);
    }
  });

  it('permits only the transitions listed in the table, and no others', () => {
    // Exhaustive sweep of the entire state space. Any pair not backed by a rule
    // must be refused for every actor, under the most permissive context.
    const permissive = {
      paymentCaptured: true,
      proofRequirementsMet: true,
      hasOpenDispute: false,
      isAssignedWorker: true,
      hasAssignedWorker: false,
    };

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const hasRule = TRANSITION_RULES.some((r) => r.from.includes(from) && r.to === to);
        if (hasRule) continue;

        for (const actor of ['REQUESTER', 'WORKER', 'ADMIN', 'SYSTEM'] as const) {
          expect(
            allowed(from, to, actor, permissive),
            `${from} → ${to} as ${actor} has no rule and must be refused`,
          ).toBe(false);
        }
      }
    }
  });
});

describe('error reporting', () => {
  it('throws IllegalTransitionError with an actionable reason', () => {
    expect(() => assertTransitionAllowed('DRAFT', 'PUBLISHED', 'REQUESTER', {})).toThrow(
      IllegalTransitionError,
    );

    try {
      assertTransitionAllowed('DRAFT', 'PUBLISHED', 'REQUESTER', { paymentCaptured: false });
    } catch (error) {
      expect((error as Error).message).toContain('payment');
    }
  });

  it('does not throw for a legal transition', () => {
    expect(() =>
      assertTransitionAllowed('DRAFT', 'PUBLISHED', 'REQUESTER', { paymentCaptured: true }),
    ).not.toThrow();
  });

  it('names the permitted actors when the wrong one tries', () => {
    const result = checkTransition('COMPLETED', 'PAYMENT_RELEASED', 'REQUESTER');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('SYSTEM');
  });
});

describe('availableTransitions', () => {
  it('offers a requester approve, reject and dispute on a submitted task', () => {
    const options = availableTransitions('SUBMITTED', 'REQUESTER', { hasOpenDispute: false });
    expect(options).toEqual(expect.arrayContaining(['COMPLETED', 'IN_PROGRESS', 'DISPUTED']));
  });

  it('withdraws approval as an option once a dispute is open', () => {
    const options = availableTransitions('SUBMITTED', 'REQUESTER', { hasOpenDispute: true });
    expect(options).not.toContain('COMPLETED');
  });

  it('offers nothing on a terminal task', () => {
    expect(availableTransitions('PAYMENT_RELEASED', 'ADMIN')).toEqual([]);
  });
});
