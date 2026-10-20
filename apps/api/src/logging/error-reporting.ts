import * as Sentry from '@sentry/node';
import { loadEnv } from '../config/env';

let enabled = false;

/**
 * Error reporting (docs/22, #16): every error-level log line also goes to
 * Sentry when SENTRY_DSN is set, so a failure is seen without anyone reading
 * container logs. That covers unhandled request errors, sweep failures, a
 * refund or payout that gave up, and every "Reconciliation:" finding, since
 * each of those is already logged at error level. Without a DSN this does
 * nothing.
 */
export function initErrorReporting(role: string): void {
  const env = loadEnv();
  if (!env.SENTRY_DSN || enabled) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    serverName: role,
    // Errors only: no performance tracing, no request bodies, no PII.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  enabled = true;
}

/** Called from pino's log hook for every error-level line. */
export function reportLoggedError(args: unknown[]): void {
  if (!enabled) return;
  const error = args.find((a): a is Error => a instanceof Error);
  const message = args.find((a): a is string => typeof a === 'string') ?? 'Error logged';
  const context = args.find((a) => a && typeof a === 'object' && !(a instanceof Error)) as Record<string, unknown> | undefined;
  Sentry.withScope((scope) => {
    if (context && typeof context.context === 'string') scope.setTag('context', context.context);
    if (error) Sentry.captureException(error, { extra: { message } });
    else Sentry.captureMessage(message, 'error');
  });
}
