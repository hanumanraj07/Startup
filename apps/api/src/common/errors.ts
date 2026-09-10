/**
 * Typed domain errors.
 *
 * Services throw these; one exception filter maps them to HTTP status codes.
 * Never throw a bare string, and never leak an internal message to a client.
 * See ai/coding-rules.md.
 */

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 400;
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  readonly status = 401;
}

export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
  readonly status = 403;
}

/**
 * Also used where revealing that a resource exists would itself leak
 * information. A worker probing task identifiers must not learn which ones
 * exist, so an unauthorised read returns this rather than a 403.
 */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly status = 404;
}

export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';
  readonly status = 409;
}

/** A valid request that violates a business rule. */
export class BusinessRuleError extends DomainError {
  readonly code = 'BUSINESS_RULE_VIOLATION';
  readonly status = 422;
}

/** Another worker accepted first. Ordinary marketplace outcome, not a fault. */
export class TaskAlreadyAssignedError extends DomainError {
  readonly code = 'TASK_ALREADY_ASSIGNED';
  readonly status = 409;

  constructor() {
    super('Another worker accepted this task first.');
  }
}

export class IllegalTransitionError extends DomainError {
  readonly code = 'ILLEGAL_TASK_TRANSITION';
  readonly status = 422;
}

export class InsufficientVerificationError extends DomainError {
  readonly code = 'INSUFFICIENT_VERIFICATION';
  readonly status = 403;
}
