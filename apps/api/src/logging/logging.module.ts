import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv } from '../config/env';

/**
 * Structured logging via pino, with a correlation ID on every request.
 *
 * `app.useLogger(app.get(Logger))` in main.ts is what makes this a drop-in
 * replacement for Nest's console logger: every existing `new Logger('X')`
 * call site across the codebase (24 of them, unchanged by this) keeps
 * working exactly as written, now routed through pino instead of
 * console.log. See nestjs-pino's own docs on why this override is enough —
 * Nest's Logger class delegates to whatever instance `useLogger` registers.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: () => {
        const env = loadEnv();
        const isProduction = env.NODE_ENV === 'production';

        return {
          pinoHttp: {
            level: env.LOG_LEVEL,
            // JSON in production (what a log aggregator wants); colorized,
            // human-readable output everywhere else.
            transport: isProduction
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } },
            // Correlates every log line for one request, and every service
            // downstream of it that echoes the same header back (Caddy,
            // Vercel, a browser's own network tab). Reuses an inbound id
            // when the caller already set one, rather than always minting a
            // fresh one, so a request that already carries a trace id from
            // upstream keeps it end to end.
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const inbound = req.headers['x-request-id'];
              const id = (Array.isArray(inbound) ? inbound[0] : inbound) ?? randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            // Never let request/response logging leak auth material into
            // log storage — docs/16-security-requirements.md's PII/secrets
            // handling applies to logs as much as to API responses.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
            // The health check runs every few seconds and carries no
            // information worth a log line; everything else does.
            autoLogging: {
              ignore: (req: IncomingMessage) => req.url === '/health' || req.url === '/health/ready',
            },
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
