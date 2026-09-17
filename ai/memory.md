# Project Memory — Decision Log

The running record of what has been decided, why, and what was rejected. Read this before proposing an architectural change, so settled questions are not re-argued from scratch.

Newest entries at the top. Every entry states the decision, the reasoning, and what was considered and turned down.

---

## 2026-09-07 — Build sequence: specs before code

**Decided.** Write the complete `docs/` and `ai/` specification layer before writing application code.

**Why.** This is the founder document's own strongest recommendation and it is correct. When architecture and business logic are invented at the same time as the code, every session re-decides the data model and the rules drift. The specification layer is what makes later work consistent.

**Rejected.** Scaffolding the monorepo first and documenting afterwards. Documentation written after code describes what happened rather than governing it.

---

## 2026-09-07 — Product name: OnSite

**Decided.** The product is **OnSite**.

**Why.** It states the positioning directly: someone on the ground, wherever you need them. It works for the consumer pitch and survives the later move to business customers.

**Rejected.** Setu, meaning bridge, which was distinctive but needed explaining. OnGround, which was clear but flatter. Bharosa, meaning trust, which was emotionally strong for consumers but awkward for enterprise sales.

---

## 2026-09-07 — Client architecture: one web codebase, installable as a PWA

**Decided.** A single Next.js application serves the marketing site, the requester app, the worker app and the admin console. It is installable as a PWA with Web Push. No native mobile app for now.

**Why.** One codebase reaches production far faster than two, and needs no app store review to ship a fix. On Android, roughly 95% of the Indian market, install, push, camera and geolocation all work.

**Known cost, accepted.** On iOS, push requires the user to add the app to the home screen, and there is no background geolocation or background sync. This is tolerable because the design captures GPS at discrete moments, arrival and proof submission, rather than tracking workers continuously. Worker onboarding includes an explicit iOS install step.

**Trigger to revisit.** iOS becoming a meaningful share of active workers, or a genuine need for background location.

**Constraint this creates.** `packages/types`, `packages/validation`, `packages/money` and `packages/utils` must stay free of Node built-ins and DOM assumptions, so a React Native app can consume them later. Cheap now, expensive to retrofit.

---

## 2026-09-07 — ORM: Prisma, with PostGIS quarantined

**Decided.** Prisma for the whole schema. All spatial SQL confined to `apps/api/src/repositories/geo.repository.ts` behind typed wrappers.

**Why.** Verified as of September 2026: Prisma still has no native geography type, and PostGIS columns map to `Unsupported`. Spatial queries must use `$queryRaw`. That is an acceptable cost because spatial queries are a small, well-bounded part of the system, while Prisma's migrations, relations and Studio benefit the other 95%. Studio also substitutes for the missing local `psql` client.

**Rejected.** Drizzle, which handles raw SQL more naturally but has weaker migration tooling. TypeORM, which has a PostGIS extension but worse day-to-day ergonomics. Neither advantage outweighed quarantining perhaps a dozen spatial queries.

**Non-negotiable.** Raw spatial SQL outside the geo repository is a defect.

---

## 2026-09-07 — The sweeper caught a real bug in the queue it exists to back up

Built the 24-hour auto-approval as two independent paths, deliberately: a BullMQ delayed job (the fast path, Redis-backed) and a `setInterval` sweeper polling `tasks.review_deadline_at` directly in Postgres (the guarantee, no Redis dependency at all). The design reasoning, worth restating: if the sweeper itself depended on BullMQ or Redis, a Redis outage would take down both the fast path and the mechanism meant to catch the fast path's failure. A plain timer against the database cannot be taken down by a queue outage.

**This paid off immediately.** The first live submission through the fast path failed to schedule with `Custom Id cannot contain :` — BullMQ rejects a colon in a custom job id, and the scheduler used `auto-approve:<taskId>`. `AutoApproveQueue.schedule` is written to swallow scheduling failures rather than let them fail the submission (a queue hiccup must never block a worker from submitting proof), so the task submitted successfully and only logged a warning: "the sweeper will still catch it at its deadline." It would have. Fixed by using `auto-approve--<taskId>` instead.

The lesson isn't just the specific bug — it's that the resilience design was proven by an actual failure on the first real run, not merely asserted in a comment. A system that degrades to its documented fallback the first time something breaks, rather than failing the user-facing operation, is doing exactly what it was built to do.

---

## 2026-09-07 — A fifth trap: `import type` on a constructor parameter breaks Nest dependency injection

`ledger.service.ts` had `constructor(private readonly prisma: PrismaClient) {}` with `PrismaClient` brought in via `import type { ... PrismaClient } from '@prisma/client'`. It compiled cleanly and looked identical to `geo.repository.ts`'s working equivalent, but failed at boot with `Nest can't resolve dependencies of the LedgerService (?)`.

The reason: Nest resolves constructor injection from TypeScript's `design:paramtypes` decorator metadata, which is only emitted for a type the compiler can see referenced as a **value** at runtime. `import type` erases the import entirely from the compiled output, so the emitted metadata for that parameter degrades to `Object`, and Nest has nothing to look up a provider by. `geo.repository.ts` uses a plain value import of `PrismaClient` and has never had this problem.

**Rule going forward:** any class-typed constructor parameter that Nest must inject requires a value import of that class, never `import type`, even where only the type is referenced in the source. This is now the second decorator-metadata trap in this codebase (the first being esbuild/tsx losing the same metadata entirely) — both point at the same lesson: Nest's DI is metadata-dependent in ways that compile without complaint and fail only at runtime, so a fresh boot-and-hit-every-route check after adding a new injectable is cheap insurance.

---

## 2026-09-07 — A fourth trap: method-level `@UsePipes()` validates every parameter, including custom decorators

Found while building Phase 3 auth: `@UsePipes(zodPipe(schema))` at the **method** level in NestJS applies that pipe to every resolved parameter of the handler, not just `@Body()`. On any handler combining `@Body()` with a custom parameter decorator such as `@CurrentUser()`, the pipe also ran against the `CurrentUser` object, tried to validate it against the body schema, and failed with `"fieldName": "Required"` on every field — a confusing symptom that looks like the request body never arrived, when the body was fine and the wrong value was being validated.

`@Res()` and `@Req()` are unaffected (Nest excludes the platform request/response objects from pipe application), which is why `register` and `login` worked while `workers.create`, `users.updateMe`, `users.submitKyc`, `users.addPayoutAccount`, and `auth.sendPhoneOtp` / `verifyPhoneOtp` all broke — every one of those combines `@Body()` with `@CurrentUser()`.

**Fix, applied everywhere this pattern occurs:** bind the pipe to the parameter, not the method — `@Body(zodPipe(schema)) body: T` instead of `@UsePipes(zodPipe(schema))` above the handler. Method-level `@UsePipes()` is safe only when the handler has no custom parameter decorators.

Caught by live end-to-end testing rather than unit tests, because a unit test calling the service directly never exercises Nest's parameter-resolution pipeline. Worth remembering: controller-level wiring bugs like this one are invisible to service-level tests and need at least one real HTTP round trip per route shape.

---

## 2026-09-07 — Three build and runtime traps, each of which failed silently

Recorded because all three produce misleading symptoms and cost real time.

**Never run the API with tsx, or any esbuild-based runner.** Nest resolves constructor injection from the `design:paramtypes` metadata that TypeScript's `emitDecoratorMetadata` emits. esbuild does not implement it. Under tsx the application boots perfectly, logs every module as initialised, then fails on the first request with `Cannot read properties of undefined (reading 'isHealthy')`, because every injected dependency is `undefined`. Use `pnpm dev`, which runs the Nest CLI, or build and run `node dist/main.js`. The seed script is fine under tsx: it is a plain script with no decorators.

**`incremental` had to be turned off for the API build.** The Nest CLI deletes `outDir` before compiling, but a surviving `tsconfig.tsbuildinfo` left tsc believing the project was already built, so it emitted nothing at all and the server started against an empty `dist` with `MODULE_NOT_FOUND`. `tsconfig.build.json` sets `incremental: false` and also `noEmitOnError: true`, so a type error can never again surface as a confusing runtime module error.

**Prisma maps `String @id` to Postgres `text`, not `uuid`.** Casting an id to `::uuid` in raw SQL therefore fails with `operator does not exist: text = uuid`. All casts in the geo repository are `::text` and `::text[]`. Native `@db.Uuid` columns would be more compact and index marginally better; at this scale that is immaterial and not worth the migration. Revisit only if row counts reach the millions.

**Also worth keeping:** in raw SQL prefer `= ANY(${array}::text[])` over an `IN` list built with `Prisma.join`. It takes one parameter instead of many, needs no empty-array special case, and puts the cast on the array rather than on each element.

---

## 2026-09-07 — PostGIS columns are database-generated, and declared to Prisma

**Decided.** Every `geography(Point, 4326)` column is a `GENERATED ALWAYS AS (...) STORED` column derived from the latitude and longitude that Prisma writes, and each is declared in `schema.prisma` as `Unsupported(...)` with a matching `@default(dbgenerated(...))`. The two GIST indexes are declared with `@@index(..., type: Gist)`.

**Why generated.** The geography can then never drift from the coordinates it comes from. No code path can set one without the other, including a raw SQL insert or a manual fix in psql. Verified: the column refuses direct writes, and updating latitude or longitude moves it automatically.

**Why the declarations matter, and this was not optional.** Without them, `prisma migrate diff` reported drift and a future `prisma migrate dev` would have quietly dropped the generated expressions and both GIST indexes. That failure would have been invisible until matching slowed down in production. With the declarations, drift is clean at exit code 0.

**Also learned.** Prisma ignores partial indexes entirely, so `tasks_open_feed_ix`, `tasks_review_deadline_ix`, `tasks_expiry_ix` and `payouts_stuck_ix` live only in the hand-written migration and are safe from the differ.

**Rejected.** Triggers, which would also have been invisible to Prisma but are more machinery and can be bypassed by a badly written migration. Also rejected: abandoning `migrate dev` for hand-written migrations only, which would have worked but made every future schema change laborious.

---

## 2026-09-07 — The application uses its own database, not the container's default

**Decided.** The Postgres container's `POSTGRES_DB` is `onsite`; the application connects to `onsite_app`, created from `template0` by a compose init script.

**Why.** The `postgis/postgis` image preinstalls postgis, postgis_topology, fuzzystrmatch and postgis_tiger_geocoder into whatever `POSTGRES_DB` names. Prisma treats any extension it did not create as drift and refuses to migrate, and the only remedy it offers is a destructive reset. A database built from `template0` carries no extensions, so Prisma creates and owns exactly one, postgis, which is also all that production needs.

---

## 2026-09-07 — Payments: Razorpay Route, and a regulatory constraint on the business

**Decided.** Razorpay Route, behind a payment provider interface with a mock driver for local development.

**Why.** Reserve Bank of India rules do not permit a marketplace to hold customer money in an ordinary current account. Pooling funds between a paying requester and a worker awaiting payout requires a nodal or escrow arrangement. Route is built for this: capture the full amount, hold it against the platform, transfer the worker's share on approval, retain the commission.

**Rejected.** Plain Razorpay Checkout plus manual bank transfers, which would put pooled customer funds in a normal account. That is a compliance problem, not a shortcut.

**Blocking dependency, and it is paperwork not engineering.** Real money movement needs a business entity, Razorpay KYC and Route activation. The full escrow flow can be built and tested end to end in test mode without any of it.

---

## 2026-09-07 — Maps: Google for geocoding, OpenStreetMap for display

**Decided.** Google Places Autocomplete and Geocoding for turning addresses into coordinates. MapLibre over OpenStreetMap tiles for rendering maps. Both behind a geocoding interface.

**Why.** Address accuracy is where this product breaks if it is wrong, and Google Places is the most reliable way to resolve a messy Indian address to an exact point. Google's India-billed Essentials tier includes 70,000 free events per month, ample at launch. Map display, however, is a solved problem that does not need paid tiles, so rendering on OpenStreetMap keeps the Google quota reserved for the calls where accuracy matters.

**Rejected.** Mappls, which has genuinely better rural and Tier 2 or 3 coverage, but whose pricing is sales-gated and starts near $300 per month. Wrong economics at launch. The interface exists so Mappls can be swapped in when coverage outside metros becomes the constraint.

---

## 2026-09-07 — Money representation: integer paise, double-entry ledger

**Decided.** All currency is integer paise. Every movement writes balanced double-entry ledger rows, and a task's entries must sum to zero.

**Why.** Floating-point currency eventually loses money and the loss is hard to find. A ledger that must balance turns a whole class of bugs into a failing assertion instead of a slow discrepancy nobody notices until a worker complains.

---

## 2026-09-07 — Scheduled work is backed by the database, not only the queue

**Decided.** Anything time-triggered, above all the 24-hour auto-approval, stores its deadline in a database column and is caught by a periodic sweeper in addition to its BullMQ delayed job.

**Why.** If Redis drops a delayed job, the queue-only design means a worker silently never gets paid. That failure is invisible until someone complains, which is the worst kind. The sweeper makes the database the source of truth and the queue merely the fast path.

---

## 2026-09-07 — Scale target: 1,000+ concurrent users, deliberately unexotic

**Decided.** Design for 1,000+ concurrent users by avoiding a specific short list of mistakes: media proxied through the API, chat by polling, connection pool exhaustion, unindexed spatial queries, and synchronous notification fan-out. Explicitly out of scope: sharding, read replicas, multi-region.

**Why.** 1,000 concurrent users is a modest load for this stack. The work is not exotic engineering, it is not making the standard errors. Building for hypothetical scale now would cost time the product needs elsewhere.

---

## 2026-09-07 — Launch scope stays narrow

**Decided.** Launch with remote inspection and verification only, in Ahmedabad and Kolkata only.

**Why.** "Anything, anywhere" invites fraud, prohibited tasks, worker safety incidents and unpriceable work, all before the marketplace has enough liquidity to survive them. A narrow category is controllable and makes the trust problem tractable.

**Consequence.** Proposals to widen scope belong in `docs/18-future-roadmap.md`, not in the codebase.

---

## 2026-09-07 — A delayed job that reschedules its own successor cannot reuse its own job id

Built the matching engine's radius expansion (docs/10) as a BullMQ job per tier: tier N's processor, on finishing, schedules tier N+1. The first version gave the job a single id per *task* (`match-tier--<taskId>`), following the same "one job, rescheduled" pattern as the auto-approve queue's `schedule()`.

**This broke on the very first live run, silently.** Tier 1 fired correctly, offered ten workers, and logged its success. Tier 2 never fired. No error, no warning — the job simply vanished. The cause: scheduling tier 2 happens *from inside* tier 1's own processor, while tier 1 is still the currently-executing job holding that job id. `queue.add()` with the same id created a new delayed job under the same Redis key tier 1 occupied. The instant tier 1's handler returned, BullMQ's `removeOnComplete: true` deleted that key — which by then held tier 2's data, not tier 1's. A job cannot safely replace itself mid-execution the way an external caller can cancel-and-reschedule a job that is merely sitting idle.

**Fixed** by giving each `(taskId, tierIndex)` pair its own job id, so a tier's processor never touches the Redis key it is currently running under. `cancelPending` (called on acceptance and expiry) no longer has "the one id" to remove; instead it sweeps every plausible tier index for that task, which is cheap and idempotent since removing a job that was never scheduled is a no-op.

**The general lesson**: `AutoApproveQueue`'s cancel-and-reschedule pattern is safe specifically because the caller rescheduling it (approve/reject) is never the job itself — the job is idle, waiting, when that happens. A job that reschedules its *own next step* from inside its own handler is a different shape of problem and needs a distinct id per step. Live verification caught this in minutes; a mocked unit test of the scheduler alone would not have, since the collision only exists against BullMQ's real completion/removal semantics.

---

## 2026-09-07 — A CORS `origin` callback that never calls its callback hangs the entire handshake, silently, forever

Built the realtime gateway's CORS policy to mirror the REST API's exactly — an explicit origin allow-list, never a wildcard with credentials, per docs/16-security-requirements.md. The first version passed `cors: { origin: () => true, credentials: true }` to `@WebSocketGateway`.

**Every single WebSocket connection attempt against the real running server hung forever.** Not an error, not a timeout, not a log line — `curl` against `/socket.io/?EIO=4&transport=polling` simply never got a response, while every ordinary REST endpoint on the same server answered instantly. That asymmetry was the first real clue: whatever was wrong was specific to the socket.io path, not the server as a whole.

**The cause.** The `cors` npm package Engine.IO uses underneath supports an `origin` option shaped as a function, but that function must be `(origin, callback)` and must call `callback(err, allow)` — it is not a plain predicate whose return value is read. A zero-argument function that returns `true` gets invoked as `originFn(requestOrigin, callback)`; it ignores both arguments, returns a value nobody looks at, and never calls `callback`. The CORS middleware then waits forever for a decision that will never come, and the entire handshake — which happens before any application code, including this gateway's own `handleConnection` auth check — hangs with it. No unit test caught this, because none of them exercise Engine.IO's actual CORS negotiation; a hang has no assertion to fail against, only a request that never returns.

**A second symptom, same root cause.** A client connecting with `transports: ['websocket']` (skipping the polling handshake) instead crashed the whole API process outright: `Unhandled 'error' event ... ECONNRESET`. The client eventually gave up on the stuck handshake and reset the connection; something in that abandoned-connection path threw on a raw socket with no listener for it. Fixing the callback bug fixed both symptoms — confirmed by deliberately reproducing the websocket-only crash again afterward and watching the process survive.

**Fixed** by extracting the actual allow/deny decision into `isAllowedOrigin(origin, webUrl)` — a pure, tested function — and wiring the gateway's `origin` option to call `callback(null, isAllowedOrigin(origin, loadEnv().WEB_URL))`. The isolation process along the way matters as much as the fix: swapping the custom Redis-backed `IoAdapter` for the stock one first, to rule out the adapter before suspecting the CORS config, is what actually found the real cause instead of stopping at a plausible-looking one.

**The general lesson**: a hang is a different failure mode from an error, and needs a different diagnostic instinct — check what DOES respond (an ordinary REST route, in this case) before assuming the whole server is broken, and treat any framework option documented as "a function" with real suspicion about its exact calling convention rather than assuming a natural-looking implementation is a compatible one.

---

## 2026-09-07 — Reading a status and later writing it is not the same as guarding the write

Built dispute freezing (docs/14) on top of the existing task-approval path (`ReviewService.completeApproval`, Phase 6). The first version's logic read as reasonable: check `assertTransitionAllowed(task.status, 'COMPLETED', ..., { hasOpenDispute: false })` against the task snapshot already in hand, and if that passed, release payment and write `COMPLETED`. `hasOpenDispute` was hardcoded `false` back in Phase 6 with a comment marking it as "the one line that changes when disputes are built" — so building disputes meant making that flag real.

**The instinct to fix it by querying for an open dispute and passing the real boolean would have been wrong**, and worth recording exactly why. That query reads the database at some moment before the write. A dispute raised in the gap between that read and the `COMPLETED` write — which is exactly what docs/14 means by "a dispute raised one second before the 24-hour auto-approval deadline must win that race" — would not be seen by the check, and the plain `update()` that followed would silently overwrite the dispute's `DISPUTED` status with `COMPLETED`, releasing payment on a task someone had just disputed.

**Fixed** by making the status write itself the guard, the same pattern `TasksService.accept()` already used for the double-acceptance race: `prisma.task.updateMany({ where: { id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, data: { status: 'COMPLETED', ... } })`. Postgres serializes concurrent writes to one row; whichever transaction commits first — the dispute's own atomic freeze, or this release — wins, and the other's `updateMany` affects zero rows. `completeApproval` now checks that count and returns `{ acted: false }` rather than proceeding to release payment. `reject()` and `DisputesService.raise()` got the identical treatment.

**The general lesson, worth restating because it is easy to re-learn the hard way**: a read-then-conditionally-write pattern is a TOCTOU race no matter how correct the condition looks, whenever the write that follows is not itself conditioned on the state the read observed. The fix is never "read more carefully" or "read closer to the write" — it is to make the database enforce the condition atomically as part of the write. This is the same principle `accept()`'s comment already stated for the double-acceptance race; disputes are the second time this codebase needed it, and probably not the last.

**Verified live, not just in a fake-Prisma unit test**: fired a real HTTP `POST /tasks/:id/dispute` and a real HTTP `POST /tasks/:id/approve` at the same SUBMITTED task with `Promise.all` — genuinely concurrent requests, real auth, real database. Exactly one succeeded (the dispute); the other came back a clean `422 ILLEGAL_TASK_TRANSITION`; the payment stayed `CAPTURED`. See TODO.md's Phase 9 entry for the full verification, including the subsequent admin resolution and ledger balance check.

---

## 2026-09-07 — A tight limit on two dimensions at once throttles innocent traffic, not abuse

Built `docs/16-security-requirements.md`'s "applied per IP and per account, whichever binds first" as two independently-tracked throttler dimensions on top of `@nestjs/throttler`'s default (`default`, IP-based): `account` (keyed by the email/phone in an unauthenticated request's body, for login/register/password-reset/OTP) and `user` (keyed by the `sub` claim decoded — never verified — from an authenticated request's bearer token, for task creation, accept, payment creation, messages). The second copy of AUTH_THROTTLE-style routes tightened BOTH `default` and the new dimension to the identical number, on the reasoning that more limits can only mean more safety.

**That reasoning is backwards, and load-testing the accept-herd scenario from docs/20 caught it on the first run.** Fifty real, distinct workers accepting the same task — the exact scenario the whole atomic-`updateMany` design exists to make safe — all originate from one IP in any test harness (and, in the real world, from one shared IP behind a mobile carrier's CGNAT or an office network, which is common in India specifically). Tightening `default` to the same 30-per-minute figure as the new per-worker `user` dimension meant the fiftieth-and-onward request in a single burst got blocked by the IP bucket, regardless of the fact that each of the fifty distinct workers was individually nowhere near its own limit. Fifty legitimate people racing for one task is not the failure mode a rate limit exists to stop; it's the marketplace working.

**Fixed** by only tightening the dimension the spec actually names for each route (`user` for task creation/accept/payments/messages, both `account` and `default` for the genuinely IP-relevant login-family routes) and leaving the other dimension at the module's generous baseline. The general lesson: a rate limit's job is to bound one specific actor's or one specific line's abuse, and stacking the identical tight number onto every dimension a request happens to have doesn't add safety — it just finds the first legitimate traffic pattern that touches more than one of those dimensions at once and blocks it.

**A second, purely mechanical finding along the way**: `@nestjs/throttler`'s `ThrottlerGuard.canActivate` only ever iterates throttler names already declared in the module-level `ThrottlerModule.forRoot({ throttlers: [...] })` array — a route's `@Throttle({ user: {...} })` can override an existing name's limit, but cannot introduce `user` as a name the guard will ever check if it isn't already registered there. Discovered by watching `throttle:user:*` keys simply never appear in Redis despite the route-level config looking correct; fixed by registering `account` and `user` at the module level too, with deliberately enormous default limits so routes that never override them are effectively unthrottled on those dimensions.

Verified live twice: once by inspecting the actual Redis keys created after a real request (confirming both dimensions are tracked as genuinely separate counters), and again by re-running the accept-herd test after each fix — the first fix alone still failed for reasons the second fix explained, and only both together produced clean runs.

---

## 2026-09-07 — A Docker multi-stage build generates the Prisma client before it has a schema to read

Wrote `apps/api/Dockerfile` as a standard three-stage build: install dependencies (cached across source-only changes, so only `package.json` files are copied into that stage), then copy real source and compile, then copy only the compiled output into a slim runtime image.

**Building it — not just writing it — surfaced 76 TypeScript errors** in the compile stage that looked like they had nothing to do with each other: implicit `any` on nearly every Prisma query result's callback parameter, `Property 'sql' does not exist on type 'typeof Prisma'`, `Module has no exported member 'User'`. None of those are real problems with the application code, which typechecks and builds cleanly outside Docker.

**The cause**: `pnpm install` in the dependency stage triggers `@prisma/client`'s own postinstall, which runs `prisma generate`. At that point in the build, only `package.json` files exist in the image — deliberately, so that layer stays cached when only application source changes, not dependencies. `prisma/schema.prisma` isn't copied in until the next stage. `prisma generate` running with no schema to read produces an empty, typeless stub client, and that stub — not the real one — is what's sitting in `node_modules` when `nest build` runs moments later in the same image.

**Fixed** by explicitly running `prisma generate` again, after the real schema is copied in and before `nest build`, rather than trusting the implicit postinstall generate from the earlier stage. The general lesson, the same shape as several others in this file: a dependency's own install-time side effect can silently produce a plausible-but-wrong artifact when it runs before the input it needs exists, and the failure it causes downstream looks nothing like its actual cause — the fix was found by building the image for real and reading the compiler's confusion literally, not by reasoning about the Dockerfile in the abstract.

---

## 2026-09-10 — `pnpm dev` runs package.json scripts through `cmd.exe` on Windows, not the invoking shell

`apps/web/package.json`'s `dev` and `start` scripts read `next dev -p ${WEB_PORT:-3000}` — ordinary bash default-value substitution, and it matched the convention `apps/api` already used for its own port. Running it via `pnpm --filter @onsite/web dev`, even from inside a bash session, failed: Next.js's CLI rejected `${WEB_PORT:-3000}` as a literal, invalid port number.

**The cause**: pnpm executes `package.json` scripts using the OS's default shell, not the shell that invoked `pnpm` — on Windows that's `cmd.exe` regardless of whether the surrounding terminal is bash. `cmd.exe` has no `${VAR:-default}` syntax, so the string was never expanded; it was passed to `-p` verbatim.

**Fixed** by dropping the flag entirely rather than reaching for a shell-abstraction dependency (`cross-env` and friends only solve *setting* a variable portably, not *conditional defaulting*): `next dev --help` confirms `-p`/`--port` already falls back to reading the standard `PORT` env var when omitted, which needs no shell parsing at all. `.env.example` renamed `WEB_PORT` to `PORT` to match. The general lesson: a `package.json` script that looks like ordinary shell is only portable if every developer's (and every CI runner's, and every container's) default shell agrees on the syntax — prefer whatever the tool itself reads natively over shell substitution, when the tool supports it.

---

## 2026-09-10 — A Socket.IO broadcast computed a per-viewer field once, then sent the same object to every viewer

`ChatService.send` builds a `ChatMessageView` via `toView(message, senderId)` — which sets `isMine: message.senderId === currentUserId` — and then hands that ONE object to `RealtimeGateway.emitNewMessage`, which does `this.server.to(roomFor(taskId)).emit('message:new', message)`. `server.to(room).emit` sends the identical payload to every socket in the room. There is no per-socket customization in a plain room broadcast.

The bug: `isMine` is a per-viewer fact (only the actual sender should see `true`), but it was baked into the payload once, from the sender's perspective, before the fan-out. Every other party in the room — anyone who didn't send the message — received a payload that still claimed `isMine: true`.

**Found by running two real Socket.IO client connections against the running server** (one authenticated as the requester, one as the worker, both joined to the same task room), having one send a message over the REST endpoint, and reading what each socket actually received — not by reading the gateway code, which reads as correct in isolation (`toView` itself is right; the bug is only that its output gets reused for a broadcast it wasn't computed for). The initial REST fetch (`GET /tasks/:id/messages`, which calls `toView(m, currentUserId)` once per viewer, per request) does NOT have this bug — only the live socket path, because that's the only place one `isMine` value is computed and then handed to multiple recipients.

**Fixed on the client** (`apps/web/src/app/(app)/tasks/[id]/chat-panel.tsx`) rather than the gateway: the live handler recomputes `isMine` itself from the actually-logged-in user's id (`message.senderId === user?.id`) instead of trusting the field on a real-time payload. A proper server-side fix would need per-socket emission (e.g. `socket.to(room).except(senderSocketIds).emit(...)` with a separately-computed payload for the sender), which is real work belonging to whoever next touches `RealtimeGateway` — noted here rather than done as a drive-by change to Phase 8 code during a UI-focused phase. The general lesson, the same shape as several others in this file: a value that is correct where it's computed can still be wrong wherever it's reused, if the reuse crosses a boundary (one viewer's fact broadcast to many viewers) the original computation didn't account for.

---

## 2026-09-10 — Two endpoints promised in docs/07 since Phase 6 were never actually built

Building the payment-history and worker-earnings screens for the web app, `GET /payments/mine` and `GET /payouts/mine` — both listed in `docs/07-api-specification.md`'s own tables since it was written — turned out not to exist anywhere in `apps/api/src`. Confirmed with a grep across the whole API source, not assumed from the docs going stale. Only `POST /payments/orders` and `GET /payments/:taskId` were ever implemented; the underlying `Payment` and `Payout` Prisma models already had everything needed to serve a list, they just had no route reading them back.

**Added them**, which is a deliberate, one-time exception to this phase's own rule of building UI only against the API surface that already exists: the two screens the design spec calls for (docs/19: "Requester: ... history", "Worker: ... earnings") are not buildable at all without a list to read, mocking one up client-side would mean inventing data, and the endpoints themselves are small, read-only, cursor-paginated, and follow the exact projection pattern already used by `TasksService.listMine` and `ChatService.list` — low risk, not a scope expansion in any way that invents new behavior. `payouts/mine` needed its own controller (`payouts.controller.ts`) since payouts live under a `/payouts` prefix in the spec, separate from `/payments`.

**Live-verified** against the real completed task from the lifecycle-completion test: `payments/mine` returned the RELEASED ₹500 payment, `payouts/mine` returned the PENDING ₹425 payout — the same numbers that test produced, read back through routes that didn't exist an hour earlier. The general lesson: a spec file being complete and detailed does not guarantee every endpoint it lists was actually built — this project's own docs/07 had been treated as ground truth all session, and it was still wrong about what existed.

**The same gap shape recurred immediately after, on KYC.** `POST /users/me/kyc` has always existed and assumes `documentFrontKey`/`selfieKey` already sit in storage, but there was never a presign route to get a file into storage for KYC in the first place — `StorageService` only had `presignTaskProofUpload`, hard-scoped to task proofs. Added `presignKycDocumentUpload` plus `POST /users/me/kyc/presign` the same way, and it live-verified the same way: a real image uploaded straight to MinIO, submission accepted, status flipped from `NONE` to `PENDING`.

**And a third time, on the trust badge.** `@onsite/types` has defined a `PublicWorker` interface (rating, rating count, tasks completed, completion rate) since Phase 1's spec-writing pass, but `GET /users/:id/public` only ever returned plain `PublicUser` — grepped the whole API source and `PublicWorker`/`toPublicWorker` appeared nowhere at all, not even in a test. Fixed the same shape of way: added `toPublicWorker` to `common/projections.ts`, had `getPublicProfile` return it when the target has a worker profile. This one also got a proper PII snapshot test it had never had (`common/projections.test.ts`), since `toPublicUser`/`toSelfUser` are among the most-reused projections in the codebase and had somehow never been asserted on directly.

Three for three now on "a type or a route the docs/shared-package/DB schema all assume exists, but nobody wrote the last piece connecting them" — confidently a pattern, not a coincidence. The common shape: Phase 1's specification layer and the shared `@onsite/types`/`@onsite/validation` packages were written completely and correctly ahead of the backend phases, and later backend work correctly consumed the parts it needed for its own phase's scope — but nothing ever swept back to check that every type and every documented route actually got a corresponding implementation. Worth checking directly (grep for a type name, or for a documented path) rather than assuming "the spec says so" ever again in this project.

**A fourth instance turned up immediately after, building the admin dispute evidence viewer.** `DisputesService.getEvidenceBundle` already assembled every proof's metadata (type, distance, verification flags) but never had a `StorageService` to generate a viewing URL from a proof's `storageKey` — the bundle described the evidence without ever making it reachable. Fixed the same way as the KYC queue's existing pattern (`AdminService.listKycQueue` already presigned KYC documents): added `StorageService` to `DisputesModule` and `DisputesService`, presigned each proof. Four for four now — and this fourth one is the most useful data point yet, because it shows the pattern isn't confined to routes and shared-package types: **a service quietly missing a dependency it needs** is the same shape of gap, just one level more specific. After this many hits, a real endpoint-and-dependency audit (comparing every `docs/07` route against `apps/api/src/modules/**/*.controller.ts`, plus checking which services touch storage/media without importing `StorageService`) was run as a background task — see the entry below for its findings and what was and wasn't fixed as a result.

## 2026-09-10 — Endpoint audit: what docs/07 promises vs what's actually built

A background audit compared every route documented in `docs/07-api-specification.md` against `apps/api/src/modules/**/*.controller.ts`, prompted by having found four of the same "spec says X exists, it doesn't" gap by accident in one session. Roughly 65 documented routes match an implemented controller method 1:1. The gaps, and the decision on each:

- **`POST /auth/google`** — missing, `googleAuthSchema` unused. Correctly deferred: same honesty standard as always, not built without real Google credentials to test against.
- **`POST /payments/webhook`** — missing. Correctly deferred: no real Razorpay integration exists (mock provider only), so there is nothing to verify a webhook signature against yet.
- **`POST /tasks/:id/decline`** — genuinely missing, `declineTaskSchema` unused, but unlike the four fixed gaps above, **there is no `TaskDecline` table at all**. This would need a new Prisma model and migration, not a route connecting pieces that already exist — real feature work, not a connector fix. Left deferred rather than added on the side during a UI-focused phase. A worker can currently only decline implicitly, by not accepting.
- **`GET /tasks/:id/history`** — missing as a dedicated route, but the data (status transition history) is already returned inline by `GET /tasks/:id` and is exactly what the task detail page's timeline renders from. Deliberately not adding a second endpoint for data already exposed.
- **`GET /tasks/price-hint`** — missing entirely, no logic anywhere in the repo. This is real feature design (what should the estimate be based on — category averages? city? both?), not a wiring gap. Deferred; the category's `suggestedMinPaise`/`suggestedMaxPaise` range (already shown in the task wizard) covers the same user need in the meantime.
- **`POST /admin/tasks/:id/block`, `GET /admin/payments`, `POST /admin/payouts/:id/retry`, `GET /admin/metrics`** — all missing. `admin.service.ts`'s own top comment already named these as deliberately out of scope for Phase 9 (no `BLOCKED` task status exists to represent a block; no real payout gateway to retry against; a metrics dashboard is a new aggregation feature, not a trust/safety primitive). Left as documented gaps rather than built with no consumer — the admin console UI was built against every route that does exist.
- A handful of unused shared types (`TaskFeedItem`, `Paginated<T>`, `TrustProfile`, `TaskProof`, `Coordinates`/`GeoPoint`, a few enum aliases) are ordinary type-hygiene drift: the real endpoints work correctly, they just hand-roll an inline response shape instead of importing the matching shared type. Not a missing-feature signal, not touched.

The dividing line worth remembering: fix the gap immediately when it's a **pure connector** — a route, a projection branch, or an injected dependency that would just wire already-existing data through to a screen that needs it (four of these fixed this session, each small and low-risk). Leave it deferred, documented, when closing it would mean **new feature design** — a new table, new business logic, or a feature with no consumer yet. The first kind is cheap to get wrong by omission; the second kind deserves its own real design pass, not a drive-by decision made while building an unrelated screen.

---

## 2026-09-10 — Dark mode's design tokens were only ever partially redefined, and nothing caught it until Lighthouse actually rendered the page

Phase 1's `globals.css` defines five `--ink-*` tokens on the light `:root` (900/700/500/400/300) and documents, in its own comment, that dark mode redefines the *whole* palette so neither theme is ever missing a value. In practice, both dark blocks (the `prefers-color-scheme` media query and the `[data-theme="dark"]` override) only ever redefined `--ink-900` and `--ink-500`. `--ink-700`, `--ink-400`, and `--ink-300` were silently falling back to their light-mode values in dark mode the entire time this session built UI against them — dozens of components, across every phase of the web build, none of which caught it, because typechecking, `next build`, and manual light-mode-default browsing all have no way to notice a CSS custom property that resolves but is simply the wrong shade.

**Only a real Lighthouse run against the actual rendered page caught it** — its color-contrast audit measured `--ink-700` (used by the shared `Label` component, i.e. every form field label in the app) at **1.09:1** against a dark background, and `--ink-400`/`--ink-300` at 3.79:1, both far under the 4.5:1 AA minimum. This is the same shape of lesson as the chat `isMine` broadcast bug earlier in this session — a value that looks obviously fine by inspection (`--ink-700: #1c2230` reads as "a normal dark gray," nothing alarms a code reviewer) is only provably fine or broken once measured against the actual context it renders in.

Fixed by giving all three tokens real dark-mode values, computed (not eyeballed) to clear 4.5:1 with margin against both dark paper tokens. Separately, `--brand-600` turned out to be carrying two incompatible jobs under one token — legible as *text* on a dark background (needs a lighter dark-mode value, which it already had) and legible as a solid *button fill* under white text (needs a darker value, which it didn't have, measuring 3.75:1) — split into `--brand-600` (kept, text/link role) and a new `--brand-solid` (never redefined for dark, since `#2b4fd8` already clears 6.5:1 with white in both themes).

**The general lesson for this project specifically**: a design-token system with light/dark pairs needs every single token checked in both modes at least once with a real contrast tool before being trusted, not just "the ones that seemed likely to matter" — the two tokens missed here (`ink-700`, used for form labels; `ink-400`/`ink-300`, used for the vast majority of captions and secondary text in the app) were arguably the *most*-used tokens in the whole system, not edge cases. If this project ever changes its color tokens again, re-run Lighthouse's color-contrast audit against both themes before considering the change done — "it typechecks and the light mode looks right" said nothing true about dark mode this time.

---

## 2026-09-10 — The founder provided real Razorpay test credentials; the deferred payment integration is now built and live-verified against Razorpay's real sandbox

Every prior phase of this project deliberately stopped short of building the real Razorpay integration, on the same honesty principle applied to Google sign-in: don't fake something that needs real third-party credentials to actually verify. That changed this session — real test-mode Key ID and Key Secret were provided with explicit instruction to use them for testing.

**What got built**: `razorpay.service.ts` (order creation, HMAC-SHA256 webhook signature verification via `timingSafeEqual`), `PaymentsService.createOrder`'s Razorpay branch (creates a real order, does NOT capture — only the webhook can), and `POST /payments/webhook` end to end. The `WebhookEvent` Prisma model already existed, unique `eventId` and all, complete with a comment about replay safety — but had never been wired to a controller. **This is the fifth instance this session of the same shape of gap**: something the schema/types/docs clearly anticipated, sitting unused until a screen or a feature that actually needed it got built. The running tally across this project: `payments/mine` + `payouts/mine` (missing routes), the KYC document presign route (missing route), `PublicWorker` (unused type), the dispute evidence bundle's missing `StorageService` (a service missing a dependency it needed), and now the entire `WebhookEvent` model (an unused table). Five for five is well past coincidence — this project's specification-first phase was thorough, and every phase after it correctly built only what its own scope needed, but nothing ever came back to check that every promise made by the schema and the docs got kept.

**Live-verified against Razorpay's actual API, not simulated**: created a real order and confirmed it independently by querying `api.razorpay.com` directly with basic auth — a real order sitting in Razorpay's sandbox, receipt correctly set to the task id. Then proved the webhook path completely by hand-crafting a `payment.captured` payload, HMAC-signing it with the real webhook secret, and POSTing it to the local endpoint: correctly-signed → captured, ledger balanced, exactly once; replayed → accepted idempotently with zero additional rows; forged signature → rejected `422`, but still recorded as an audit row rather than silently dropped. This is the same "prove it against the real thing" discipline that has run through the whole project, just now with a real external system on the other end instead of only the project's own database.

**What's still honestly not built**: real payout transfers to workers. Razorpay Route needs each worker to have a "Linked Account" (its own KYC-gated onboarding on Razorpay's side) before a Transfer API call can move money to them — that's a real, separate feature with its own scope, not a few more lines next to order capture. `Payout` rows still just record what's owed, same as before.

**A process note worth keeping**: the user pasted real API secrets directly into the chat. The right response was to write them straight into `apps/api/.env` (gitignored, confirmed before this session's earlier commit) rather than have them sit in chat history any longer than necessary, and to say so plainly rather than silently accept them as if it were unremarkable. Also worth remembering: `.env` file changes are NOT picked up by `nest --watch`'s file watcher (it only watches compiled TypeScript sources) — a full process restart is required after editing `.env`, and forgetting this cost a few minutes of confusion mid-session testing against what turned out to be stale env values.

---

## 2026-09-10 — Google sign-in built once real OAuth credentials were provided, and a leaking-500 bug caught by testing the rejection path

Same story as Razorpay, same day: Google sign-in stayed on the "not built without real credentials" list through every prior phase, and came off it the moment the founder provided a real OAuth client id and secret. Built `POST /auth/google`, `GoogleAuthService` (verifies the ID token against Google's actual public keys via `google-auth-library` — signature, expiry, issuer, and audience match against this app's own client id), `AuthService.loginWithGoogle`'s three-way account resolution (existing Google-linked account, link-onto-existing-email-account, or brand new passwordless account), and a `GoogleSignInButton` using Google's own rendered button on the frontend.

**The founder pasted the OAuth client's redirect URI as a screenshot before sending the real values**, and it was configured for Claude's own MCP callback (`https://claude.ai/api/mcp/auth_callback`) — from setting up an unrelated Google connector in Claude's own settings, not from anything to do with this app. Flagged it plainly rather than silently reusing a misconfigured client. The founder's call was to add `http://localhost:3000` to that same client's Authorized JavaScript origins rather than create a dedicated one — a reasonable simplification, since the ID-token sign-in flow this app uses only reads Authorized JavaScript origins and never touches the redirect URI at all, so the stray Claude callback sitting there is inert for OnSite's purposes.

**Live-verified the part that actually matters — rejection, not the happy path.** A full click-through (real consent screen, real Google account) needs a real browser, which isn't available here — same honest limit as every other UI flow this session. What IS provably testable without one: does the verification actually reject a forgery? Sent a malformed token (wrong segment count) and a well-formed-but-unsigned JWT carrying entirely plausible claims — right audience, right issuer, a believable payload — and both were rejected. The second case matters more: it proves the code is genuinely checking the cryptographic signature against Google's live keys, not just validating shape or claims that anyone could fabricate.

**That same test caught a real bug**: the malformed-token case came back as a generic `500 INTERNAL_ERROR`, not a clean `401`. `google-auth-library` throws a bare `Error` on any verification failure and nothing was catching it, so `DomainExceptionFilter` treated it as an unhandled exception. Fixed by catching it in `GoogleAuthService` and re-throwing this codebase's own `UnauthenticatedError` (logging the real cause server-side, never exposing library internals to the client). The general lesson, same shape as several entries above: testing the failure path isn't a formality once real external verification is involved — this bug was invisible until an actual malformed input was thrown at the actual verification call, because nothing about the code read as wrong in isolation.

---

## 2026-09-16 — First real deployment: frontend on Vercel, backend on Oracle Cloud Always Free, proven with a real cross-service write, not just health checks

The founder had no money for hosting, so this had to be genuinely free, not "free trial." Frontend went to Vercel (`https://onsite-orcin.vercel.app`) using a real Vercel API token — the only real snag there was monorepo-shaped: deploying from `apps/web` in isolation uploads only that subdirectory, which breaks `workspace:*` resolution because plain `npm install` doesn't understand pnpm's workspace protocol. Fixed by setting the Vercel project's `rootDirectory` to `apps/web` via the REST API and deploying from the true repo root instead, so Vercel's build sees `pnpm-workspace.yaml` and runs `pnpm install` correctly.

**The backend hit a real capacity wall.** Oracle's free Ampere `VM.Standard.A1.Flex` shape — the one with enough RAM to self-host Postgres+Redis+MinIO — returned "out of capacity" in every availability domain, on every retry, across both requested sizes. This is a known, common Oracle Free Tier condition, not a configuration mistake. Fell back to `VM.Standard.E2.1.Micro` (AMD, always available, but only 1 OCPU/1GB RAM), which forced a real architecture change: **Postgres, Redis, and object storage moved off the box entirely** onto free managed services — Neon (Postgres+PostGIS), Upstash (Redis over TLS), Cloudflare R2 (S3-compatible). Only the API container runs on the instance itself. A 4GB swap file was added before attempting the Docker build, since building this monorepo's API image (pnpm install + prisma generate + nest build, all inside one multi-stage build) would very likely OOM on 1GB of real RAM otherwise — it didn't, but it took close to 7 minutes on the single OCPU, which swap made survivable rather than fast.

**Proof, not assertion, at every layer**: SSH connectivity confirmed by actually connecting before touching anything else; the local `iptables` chain was found default-configured to reject everything but port 22 (a second, separate firewall from Oracle's network-level Security Lists, easy to miss if only the console-level rule is opened); after opening both, `prisma migrate deploy` was run for real against the live Neon database and all three existing migrations applied cleanly; the container was started and `/health/ready` was curled from an outside machine (not from inside the instance) and returned `{"status":"ready","checks":{"database":true}}`; finally, after pointing Vercel's `NEXT_PUBLIC_API_URL` at the real backend IP and redeploying, `POST /auth/register` was called with the Vercel origin in the request and returned a real created user — proving the CORS configuration and the live Neon write path work together, not just each in isolation.

**Two operational details worth remembering for next time this instance is touched**: (1) the SSH private key Oracle generates is shown exactly once and never stored server-side — if the download is missed, the only recovery is a fresh instance, not a re-download; (2) this session's sandbox has a standing guard against starting a throwaway listening service just to probe connectivity (blocked an attempt to spin up `python3 -m http.server` purely as a reachability test) — the correct move when that happens is to verify connectivity through the real service being deployed instead of a synthetic one, not to look for a workaround.

**What's still honestly not done, deliberately left on the TODO list rather than silently glossed over**: `EMAIL_PROVIDER=console` in the deployed environment, meaning verification emails print to Docker logs rather than sending — since email verification gates all real use of the app, no outside user can actually complete signup on this live deployment yet, only whoever can read the container logs. A reverse proxy with real TLS in front of the raw `http://` backend is also still missing. Both are one more round of real third-party setup away, same pattern as everything else this project has treated honestly all along.

---

## Open questions for the founder

Recorded here so they are not forgotten. None block current work.

1. **Business entity registration.** Determines whether real payouts and DLT-registered SMS are weeks or months away, and therefore whether a manual payout bridge is a short stopgap or the plan for the year.
2. **Cancellation and refund policy.** A proposed starting point is compensating the worker `min(₹50, 10% of budget)` when a requester cancels after assignment. This is a business decision, and it needs to appear in the business model doc and the legal pages.
3. **Concierge pilot before launch.** The founder document recommends manually brokering the first tasks over WhatsApp to test willingness to pay before relying on the platform. Strongly worth doing, and it would reorder the build phases.
4. **Domain name.** Needed for DNS, the email sender identity and the legal pages.
