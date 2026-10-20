import { describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((fn: (scope: { setTag: () => void }) => void) => fn({ setTag: vi.fn() })),
}));
vi.mock('@sentry/node', () => sentry);
vi.mock('../config/env', () => ({ loadEnv: () => ({ SENTRY_DSN: 'https://key@o0.ingest.sentry.io/1', NODE_ENV: 'production' }) }));

import { initErrorReporting, reportLoggedError } from './error-reporting';

/** docs/22, #16: error-level log lines reach Sentry once a DSN is set. */
describe('error reporting', () => {
  it('sends a logged message and a logged error once initialised', () => {
    reportLoggedError(['before init']);
    expect(sentry.captureMessage).not.toHaveBeenCalled();

    initErrorReporting('worker');
    expect(sentry.init).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'worker', tracesSampleRate: 0, sendDefaultPii: false }));

    reportLoggedError([{ context: 'ReconciliationService' }, 'Reconciliation: LEDGER_UNBALANCED task t1']);
    expect(sentry.captureMessage).toHaveBeenCalledWith('Reconciliation: LEDGER_UNBALANCED task t1', 'error');

    const boom = new Error('db down');
    reportLoggedError([boom, 'Sweep "refunds" failed']);
    expect(sentry.captureException).toHaveBeenCalledWith(boom, { extra: { message: 'Sweep "refunds" failed' } });
  });
});
