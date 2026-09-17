import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { MatchingService } from './modules/matching/matching.service';
import { SocketRedisAdapter } from './modules/realtime/socket-redis.adapter';
import { ReviewService } from './modules/tasks/review.service';
import { SweeperService } from './modules/tasks/sweeper.service';
import { startAutoApproveWorker } from './queue/auto-approve.worker';
import { startMatchingWorker } from './queue/matching.worker';

/** docs/05-system-architecture.md: "sweeper.reviewDeadlines | Every 60s". */
const SWEEPER_INTERVAL_MS = 60_000;

/**
 * Two runtimes from one codebase, selected by ROLE.
 *
 *   ROLE=api     HTTP requests and WebSocket connections. Stateless.
 *   ROLE=worker  BullMQ consumers and sweepers. No HTTP surface.
 *
 * They are separated so a burst of matching fan-out cannot slow request
 * handling, and so each scales on its own signal.
 * See docs/05-system-architecture.md.
 *
 * RUN THIS WITH tsc, NEVER WITH tsx OR ANY esbuild-BASED RUNNER.
 *
 * Nest resolves constructor injection from the `design:paramtypes` metadata
 * that TypeScript's emitDecoratorMetadata produces. esbuild does not implement
 * it, so under tsx every injected dependency silently becomes undefined and the
 * application boots cleanly, then fails at the first request with
 * "Cannot read properties of undefined". Use `pnpm dev`, which runs the Nest
 * CLI, or build and run `node dist/main.js`.
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new Logger('Bootstrap');

  if (env.ROLE === 'worker') {
    // No HTTP server: this process only runs background work. See
    // docs/05-system-architecture.md's process split.
    const context = await NestFactory.createApplicationContext(AppModule, {
      logger: env.LOG_LEVEL === 'debug' ? ['error', 'warn', 'log', 'debug', 'verbose'] : ['error', 'warn', 'log'],
    });

    const review = context.get(ReviewService);
    const sweeper = context.get(SweeperService);
    const matching = context.get(MatchingService);

    // Fast path: a BullMQ worker consuming delayed auto-approve jobs.
    const autoApproveWorker = startAutoApproveWorker(review);

    // The matching pipeline's radius-expansion consumer. See
    // docs/10-matching-engine.md and matching.service.ts.
    const matchingWorker = startMatchingWorker(matching);

    // Guarantee path: a Redis-independent poll of the database, covering
    // both review-deadline auto-approval and task-deadline expiry. Started
    // regardless of whether the BullMQ workers above are healthy.
    sweeper.start(SWEEPER_INTERVAL_MS);

    context.enableShutdownHooks();
    process.on('SIGTERM', () => {
      sweeper.stop();
      void autoApproveWorker.close();
      void matchingWorker.close();
    });

    logger.log('OnSite worker process started.');
    logger.log(`  auto-approve queue: consuming (fast path)`);
    logger.log(`  matching queue: consuming (radius expansion)`);
    logger.log(
      `  sweeper: every ${SWEEPER_INTERVAL_MS}ms (review-deadline + task-expiry guarantee paths, no Redis dependency)`,
    );
    return;
  }

  const app = await NestFactory.create(AppModule, {
    // Razorpay webhook signature verification is an HMAC over the exact raw
    // request bytes — reconstructing JSON from the parsed body and hashing
    // that instead does not reproduce the same bytes (key order, spacing)
    // and silently fails verification. Nest's `rawBody` option preserves the
    // original buffer on `req.rawBody` alongside the normal parsed body.
    rawBody: true,
    logger:
      env.LOG_LEVEL === 'debug'
        ? ['error', 'warn', 'log', 'debug', 'verbose']
        : ['error', 'warn', 'log'],
  });

  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });

  // docs/05-system-architecture.md: "Socket.IO gateway with Redis adapter"
  // — required so a chat message sent to one API replica reaches a
  // recipient's socket held open by a different replica.
  app.useWebSocketAdapter(new SocketRedisAdapter(app));

  // docs/16-security-requirements.md's exact header list. This is a JSON
  // API with no HTML views of its own, so the CSP is close to total denial —
  // `default-src 'none'` — rather than tuned for a page that renders
  // scripts and styles. `frameAncestors: none` and `X-Frame-Options: DENY`
  // together mean this API can never be iframed, which is correct for
  // something that only ever returns JSON.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true }, // 2 years
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // docs/16 asks for DENY specifically; helmet's own default is the
      // weaker SAMEORIGIN.
      frameguard: { action: 'deny' },
    }),
  );
  // Helmet v8 dropped its own Permissions-Policy option (the header's
  // directive syntax was still changing upstream), so it is set directly.
  // Geolocation and camera are used by the web app (arrival GPS, proof
  // capture), never by this API's own responses — nothing here should grant
  // either permission.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    next();
  });
  // Required to read the refresh token cookie in AuthController.
  app.use(cookieParser());

  // Allow-listed origins only. Never a wildcard with credentials.
  app.enableCors({ origin: [env.WEB_URL], credentials: true });

  // No global ValidationPipe: validation is Zod-based, using the schemas in
  // @onsite/validation that the web app shares, applied per route with
  // ZodValidationPipe. Nest's ValidationPipe is class-validator based and would
  // be a second, contradictory source of truth about what a valid request is.
  // Zod already strips unknown keys, which is what stops a client smuggling a
  // commission or a status into a create call.

  app.enableShutdownHooks();

  await app.listen(env.API_PORT);

  logger.log(`OnSite API listening on http://localhost:${env.API_PORT}`);
  logger.log(`  payments:  ${env.PAYMENT_PROVIDER}`);
  logger.log(`  geocoding: ${env.GEOCODING_PROVIDER}`);
  logger.log(`  health:    http://localhost:${env.API_PORT}/health/ready`);
}

void bootstrap();
