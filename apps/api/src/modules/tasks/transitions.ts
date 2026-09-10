import type { TaskStatus } from '@prisma/client';
import { IllegalTransitionError } from '../../common/errors';

/**
 * The task state machine.
 *
 * THIS IS THE ONLY PLACE TASK STATUS IS EVER WRITTEN. No service sets a status
 * directly. A state machine that can be bypassed is decoration, not a
 * guarantee. See docs/09-task-lifecycle.md and ai/architecture-rules.md.
 *
 * The transition table below is pure data and pure functions, deliberately
 * free of database access, so every legal and illegal transition can be tested
 * without a database. The persistence half lives in the task service, which
 * calls assertTransitionAllowed before writing.
 */

export type TransitionActor = 'REQUESTER' | 'WORKER' | 'ADMIN' | 'SYSTEM';

/** Preconditions the caller must evaluate and supply. */
export interface TransitionContext {
  /** Funds captured and held. Gates publication. */
  paymentCaptured?: boolean;
  /** Every required proof is present. Gates submission. */
  proofRequirementsMet?: boolean;
  /** An open dispute freezes release. */
  hasOpenDispute?: boolean;
  /** Whether the actor is the task's assigned worker. */
  isAssignedWorker?: boolean;
  /** Whether the task currently has an assigned worker. */
  hasAssignedWorker?: boolean;
}

export interface TransitionRule {
  from: readonly TaskStatus[];
  to: TaskStatus;
  actors: readonly TransitionActor[];
  /** Human-readable description of the precondition, used in error messages. */
  requires?: string;
  guard?: (ctx: TransitionContext) => boolean;
}

/** Exported so disputes.service.ts can reuse the exact same set the DISPUTED transition rule allows from, rather than duplicating (and risking drifting from) it. */
export const ACTIVE_WORK: readonly TaskStatus[] = [
  'ASSIGNED',
  'WORKER_EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
];

export const AWAITING_REVIEW: readonly TaskStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

/** Every status a task can be disputed FROM — mirrors the DISPUTED transition rule below exactly. */
export const DISPUTABLE_STATUSES: readonly TaskStatus[] = [...AWAITING_REVIEW, 'COMPLETED', ...ACTIVE_WORK];

/**
 * Every legal transition. Anything not listed here is illegal and rejected.
 *
 * The order matters only for error reporting; matching is by (from, to, actor).
 */
export const TRANSITION_RULES: readonly TransitionRule[] = [
  // A task is never visible to a worker before funds are captured. This is the
  // single gate that makes the escrow promise real.
  {
    from: ['DRAFT'],
    to: 'PUBLISHED',
    actors: ['REQUESTER'],
    requires: 'payment must be captured and held before a task is published',
    guard: (ctx) => ctx.paymentCaptured === true,
  },
  { from: ['PUBLISHED'], to: 'MATCHING', actors: ['SYSTEM'] },

  // Acceptance. The race is prevented at the database level by an atomic
  // conditional UPDATE, not here; this only checks the transition is legal.
  {
    from: ['PUBLISHED', 'MATCHING'],
    to: 'ASSIGNED',
    actors: ['WORKER'],
    requires: 'the task must still be unassigned',
    guard: (ctx) => ctx.hasAssignedWorker !== true,
  },

  {
    from: ['ASSIGNED'],
    to: 'WORKER_EN_ROUTE',
    actors: ['WORKER'],
    requires: 'only the assigned worker may start travelling',
    guard: (ctx) => ctx.isAssignedWorker === true,
  },
  {
    from: ['WORKER_EN_ROUTE'],
    to: 'ARRIVED',
    actors: ['WORKER'],
    requires: 'only the assigned worker may confirm arrival',
    guard: (ctx) => ctx.isAssignedWorker === true,
  },
  {
    from: ['ARRIVED'],
    to: 'IN_PROGRESS',
    actors: ['WORKER'],
    requires: 'only the assigned worker may begin work',
    guard: (ctx) => ctx.isAssignedWorker === true,
  },

  // Submission is validated, not asserted. A worker cannot submit an empty task.
  {
    from: ['IN_PROGRESS'],
    to: 'SUBMITTED',
    actors: ['WORKER'],
    requires: 'every required proof must be present before submitting',
    guard: (ctx) => ctx.isAssignedWorker === true && ctx.proofRequirementsMet === true,
  },

  // Informational only. Does NOT change the review deadline: the 24-hour clock
  // runs from SUBMITTED regardless of when the requester opens it.
  { from: ['SUBMITTED'], to: 'UNDER_REVIEW', actors: ['REQUESTER'] },

  // Approval, and auto-approval. Both refuse to release while a dispute is
  // open; the check happens inside the same transaction as the release so a
  // dispute raised a second before the deadline cannot lose the race.
  {
    from: AWAITING_REVIEW,
    to: 'COMPLETED',
    actors: ['REQUESTER', 'SYSTEM', 'ADMIN'],
    requires: 'payment cannot be released while a dispute is open',
    guard: (ctx) => ctx.hasOpenDispute !== true,
  },
  { from: ['COMPLETED'], to: 'PAYMENT_RELEASED', actors: ['SYSTEM'] },

  // Rejection sends the task back for rework. The clock restarts on resubmission.
  { from: AWAITING_REVIEW, to: 'IN_PROGRESS', actors: ['REQUESTER'] },

  // Disputes freeze everything, from any stage where money is still at stake.
  {
    from: DISPUTABLE_STATUSES,
    to: 'DISPUTED',
    actors: ['REQUESTER', 'WORKER', 'ADMIN'],
  },
  { from: ['DISPUTED'], to: 'COMPLETED', actors: ['ADMIN'] },
  { from: ['DISPUTED'], to: 'CANCELLED', actors: ['ADMIN'] },

  // Cancellation. Before assignment it is a full refund; after assignment the
  // worker is compensated. The money rules live in the payment module.
  { from: ['DRAFT', 'PUBLISHED', 'MATCHING'], to: 'CANCELLED', actors: ['REQUESTER', 'ADMIN'] },
  { from: ACTIVE_WORK, to: 'CANCELLED', actors: ['REQUESTER', 'ADMIN'] },

  // Abandonment returns the task to matching rather than punishing the requester.
  { from: ACTIVE_WORK, to: 'MATCHING', actors: ['WORKER', 'SYSTEM', 'ADMIN'] },

  // Expiry: nobody accepted before the deadline. Full refund.
  { from: ['PUBLISHED', 'MATCHING'], to: 'EXPIRED', actors: ['SYSTEM'] },
];

/** Terminal states. Nothing transitions out of these. */
export const TERMINAL_STATUSES: readonly TaskStatus[] = [
  'PAYMENT_RELEASED',
  'CANCELLED',
  'EXPIRED',
];

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface TransitionCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Whether a transition is legal for this actor under these preconditions.
 *
 * Returns a reason on failure so the caller can produce a message a person can
 * act on, rather than a bare rejection.
 */
export function checkTransition(
  from: TaskStatus,
  to: TaskStatus,
  actor: TransitionActor,
  context: TransitionContext = {},
): TransitionCheck {
  if (from === to) {
    return { allowed: false, reason: `The task is already ${from}.` };
  }

  if (isTerminal(from)) {
    return { allowed: false, reason: `${from} is a terminal state; the task cannot change.` };
  }

  const candidates = TRANSITION_RULES.filter((r) => r.from.includes(from) && r.to === to);

  if (candidates.length === 0) {
    return { allowed: false, reason: `A task cannot move from ${from} to ${to}.` };
  }

  const forActor = candidates.filter((r) => r.actors.includes(actor));
  if (forActor.length === 0) {
    const permitted = [...new Set(candidates.flatMap((r) => r.actors))].join(', ');
    return {
      allowed: false,
      reason: `${actor} cannot move a task from ${from} to ${to}. Permitted: ${permitted}.`,
    };
  }

  // Any matching rule whose guard passes permits the transition.
  const satisfied = forActor.find((r) => !r.guard || r.guard(context));
  if (!satisfied) {
    const requirement = forActor.find((r) => r.requires)?.requires ?? 'a precondition was not met';
    return { allowed: false, reason: `Cannot move from ${from} to ${to}: ${requirement}.` };
  }

  return { allowed: true };
}

/** Throws unless the transition is legal. The form services call. */
export function assertTransitionAllowed(
  from: TaskStatus,
  to: TaskStatus,
  actor: TransitionActor,
  context: TransitionContext = {},
): void {
  const result = checkTransition(from, to, actor, context);
  if (!result.allowed) {
    throw new IllegalTransitionError(result.reason ?? 'That change is not allowed.');
  }
}

/** Every status this actor could move the task to right now. Used by the UI. */
export function availableTransitions(
  from: TaskStatus,
  actor: TransitionActor,
  context: TransitionContext = {},
): TaskStatus[] {
  const seen = new Set<TaskStatus>();
  for (const rule of TRANSITION_RULES) {
    if (seen.has(rule.to)) continue;
    if (checkTransition(from, rule.to, actor, context).allowed) seen.add(rule.to);
  }
  return [...seen];
}
