# Production readiness audit

**Date:** 2026-10-20 · **Scope:** the whole system as deployed (`owl-frontend` / `main` at `31a2f03` in production, P6 at `9ec598f` locally) · **Question asked:** what will fail, conflict or lose money when thousands of requesters post tasks and thousands of workers complete them at the same time?

How this was checked: every money path, state change, background job, queue and external service was read in the code, and the live server and production database were inspected read-only (resources, containers, Redis settings, logs, and task/payment states). Nothing was changed.

Severity:

| Level | Meaning |
|---|---|
| **P0** | Already happening in production, or loses money / lets someone take money. Fix before any real user. |
| **P1** | Will break under real use (hundreds of users), or a launch blocker. |
| **P2** | Breaks at scale (thousands), or leaves the system unable to recover on its own. |
| **P3** | Hygiene: correct today, fragile tomorrow. |

---

## Summary

| # | Issue | Level |
|---|---|---|
| 1 | Background worker crashes before refunding expired tasks; **2 production tasks are expired with the requester's money still held** | P0 · **fixed locally** |
| 2 | Same crash in auto-approval: an auto-approved task is marked complete but **the worker is never paid** | P0 · **fixed locally** |
| 3 | A paid draft's price can be raised before publishing; the platform then pays out money it never collected | P0 · **fixed locally** |
| 4 | Refunds are bookkeeping only; no refund is ever sent to Razorpay | P0 · **fixed locally** |
| 5 | Workers can never actually be paid (no payout partner; mock driver only) | P1 (launch blocker) |
| 6 | Email is printed to server logs, so email sign-ups can't verify or reset passwords | P1 (launch blocker) |
| 7 | Login limited to 5 tries per 15 minutes **per IP**; Indian mobile networks share IPs across thousands of users | P1 · **fixed locally** |
| 8 | Many status changes are unconditional writes that race each other (cancel vs accept, expiry vs accept, matching vs accept, en-route vs removal) | P1 · **fixed locally** |
| 9 | Refunds, releases and dispute decisions can run twice at the same time and double-book money | P1 · **fixed locally** |
| 10 | Multi-step money flows are not atomic; a crash midway leaves tasks stuck with nobody retrying | P1 · **mostly fixed locally** |
| 11 | A dispute can freeze a task without the dispute record being created | P1 · **fixed locally** |
| 12 | Duplicate Razorpay webhooks arriving together can capture twice; a lost webhook is never recovered | P1 · **fixed locally** |
| 13 | The worker's 3-task limit is only applied to offers; a worker can accept any number of tasks from the feed | P1 · **fixed locally** |
| 14 | Production server: 1 GB RAM, already swapping ~930 MB, one machine for everything | P1 |
| 15 | Redis in production has no persistence; a restart loses all queued matching jobs and rate-limit state | P1 |
| 16 | No monitoring, alerting or error tracking; production errors are only visible by reading container logs | P1 |
| 17 | Notifications (push, email) are sent inside the user's request; slow providers slow every action | P2 · **fixed locally** |
| 18 | Matching jobs have no retry and run one at a time; a burst of tasks queues up behind each other | P2 · **fixed locally** |
| 19 | Sweeper ticks can overlap, and it loads every due task at once | P2 · **fixed locally** |
| 20 | Worker stats (completed count, completion rate) lose updates under concurrency | P2 · **fixed locally** |
| 21 | Rate-limit counters can become permanent blocks if a request dies mid-count; Redis outage fails every request | P2 · **fixed locally** |
| 22 | Live sockets keep working after a user is suspended or signs out elsewhere | P2 · **fixed locally** |
| 23 | Free public map tiles and geocoder are not allowed for production traffic | P2 |
| 24 | Free-tier hosting everywhere (Neon, Oracle, DuckDNS, Vercel Hobby) with limits and terms that don't fit a commercial launch | P2 |
| 25 | No ledger reconciliation job, despite the docs saying one exists | P2 · **fixed locally** |
| 26 | Container logs grow forever; worker shows "unhealthy" because its health check calls an HTTP server it doesn't have | P2 · **fixed locally** |
| 27 | Uploaded files are never cleaned up; tables (notifications, messages, offers) grow without limit | P3 · **fixed locally** |
| 28 | Task status writes live in many files, against the "only in transitions.ts" rule | P3 · **fixed locally** |
| 29 | CI on `main` has failed since September; no automated gate before production | P3 · **fixed locally** |
| 30 | Item bills (P6): a "shop" UPI ID could be a colluder's personal one; tax treatment unconfirmed | P3 |
| 31 | Compliance: escrow licence position, DPDP Act data handling, GST/TDS, refund policy | Business |

The first four are the ones to fix first: two are live bugs that are holding real money right now, and two let money leave the platform without being collected, or not leave when it should.

---

## P0 — fix before any real user

### 1. Expired tasks are not refunded in production

**What happens.** When a task's deadline passes with nobody accepting it, the worker process expires it and should refund the requester. The code marks the task EXPIRED, then broadcasts the change over WebSocket, then refunds. But the worker process (`ROLE=worker`) runs no WebSocket server, so the broadcast throws `Cannot read properties of undefined (reading 'to')` and the refund line never runs.

**Evidence from production (read-only query):** 2 tasks are `EXPIRED` with their payment still `CAPTURED`. The worker logs show `Sweeper failed to expire task …: TypeError: Cannot read properties of undefined (reading 'to')`.

**Where:** `apps/api/src/modules/tasks/tasks.service.ts:614` (status written), `:625` (broadcast throws), `:632` (refund never reached); `apps/api/src/modules/realtime/realtime.gateway.ts:167` (`this.server` is undefined outside the API process).

**How large companies avoid it.** Side effects that can fail (notifications, broadcasts) never sit between a state change and the money movement that must follow it. They go through an *outbox*: the state change and "send this event" are written in one database transaction, and a separate relay delivers events later. Broadcasting from background jobs goes through a message bus (here: the Redis emitter `RealtimePublisher` already used by payouts), never through a server object that only exists in one process.

**Fix.** Use `RealtimePublisher.toTask` (which works from any process) everywhere instead of `RealtimeGateway.emitTaskStatus`, and make broadcasts best-effort (never throw). Then refund the 2 stuck tasks and re-check the ledger.

**Status (2026-10-20): fixed locally, not yet deployed.** Every outbound event (status, chat, removing a user from a room) now goes through `RealtimePublisher`, which never throws; the gateway is inbound-only. A new stranded-money sweep refunds any EXPIRED or CANCELLED task, and releases any COMPLETED task, whose payment is still CAPTURED after 2 minutes; refund and release now claim the payment with a conditional update so the sweep and the live path cannot both act. Verified by running the worker role locally: an overdue task expired and was refunded with no error, 29 stranded expired tasks were refunded and 1 stranded completed task released, ledger unbalanced: 0. The 2 production tasks will be refunded by the first sweep after deploy.

### 2. Auto-approved tasks would never pay the worker

**What happens.** Same bug, worse consequence. When the requester doesn't review within 24 hours, the worker process auto-approves: it writes `COMPLETED`, broadcasts (throws in the worker process), and only then releases the payment. The task ends up `COMPLETED` with the money still held. Because the task is no longer `SUBMITTED`, the sweeper never tries again. The worker is never paid and nothing alerts anyone.

**Evidence:** all 4 completed tasks in production were approved by a person (payment `RELEASED`). No task has been auto-approved there yet, so this hasn't triggered yet, but the first one will.

**Where:** `apps/api/src/modules/tasks/review.service.ts:169` (broadcast) before `:173` (release).

**Fix.** Same as #1. Also make completion and release one transaction, or add a sweep for "COMPLETED but payment still CAPTURED" (see #10).

**Status (2026-10-20): fixed locally with #1**, including the COMPLETED-but-CAPTURED sweep, which also bumps the worker's stats and sends the completion notice the crash skipped.

### 3. Paying ₹100 and publishing a ₹50,000 task

**What happens.** A requester creates a draft at ₹100, pays ₹100, then edits the draft's price to ₹50,000 (editing a draft is allowed, and nothing checks for an existing payment). Publishing checks only that *some* payment was captured, not that it matches the price. The task goes live offering ₹42,500 to the worker. On approval the platform releases ₹50,000 from an escrow that holds ₹100. The same works with the item budget.

**Where:** `apps/api/src/modules/tasks/tasks.service.ts:299` (`update` has no payment check), `:515` (`publish` only asks `isCaptured`).

**How large companies avoid it.** The price is frozen when payment starts: an order is created against an immutable snapshot (amount, currency, line items), and fulfilment checks that what was paid equals what is owed, never just "something was paid".

**Fix.** Refuse edits to price, item budget, category and location once a payment exists. At publish, require `payment.amountPaise === requesterTotal(budget, itemBudget)`. At release, refuse when escrow holds less than the task payment (P6's `heldItemPaise` already throws there; that should alert, not just fail).

**Status (2026-10-20): fixed locally, not yet deployed.** `update` refuses budget, item budget and category once any payment row exists, including an unpaid Razorpay order (whose amount is fixed too). Location stays editable, since it moves no money. `publish` requires the captured amount to equal the task payment plus item budget, and logs an error when it does not. The wizard never edits a draft after creating it, so nothing in the app changes. Verified against the local API: raising the price after paying is refused (422), renaming still works, a mismatched payment cannot publish, a matching one can. The alert on `heldItemPaise` waits for monitoring (#16).

### 4. Refunds never reach the customer

**What happens.** Every refund (cancellation, expiry, dispute refund, split, unspent item money) writes ledger entries and marks the payment `REFUNDED`, but never calls Razorpay's refund API. In `PAYMENT_PROVIDER=razorpay` (production) the customer's card is never credited. Production uses Razorpay **test** keys today, so no real money has been affected yet.

**Where:** `apps/api/src/modules/payments/payments.service.ts:324` (`refundFull`), the item refund inside `release`, `apps/api/src/modules/disputes/disputes.service.ts` (refund and split). `razorpay.service.ts` has no refund method.

**How large companies avoid it.** A refund is a two-phase record: *refund requested* (with an idempotency key) → gateway call → *refund confirmed* by the gateway's webhook (`refund.processed`) or by polling. Failed refunds are retried and alerted, and the ledger moves only on confirmation.

**Fix.** Add a `Refund` table and a Razorpay refund call with idempotency, confirmed by webhook, with a retrying sweeper. Do this before switching to live keys.

**Status (2026-10-20): fixed locally, not yet deployed.** Migration `20261020120000_gateway_refunds` adds `refunds` and the top-up's gateway payment id. Every credit to the ledger's REFUND account queues a refund row in the same transaction (an outbox), split across the task payment and any top-ups. The sweeper sends it, claims each attempt so it is never sent twice, checks Razorpay for an earlier attempt before retrying, follows it by webhook and poll, and retries failures with backoff before flagging them. See docs/11, "How a refund reaches the requester". Verified locally: cancelling a paid task queued the refund with the ledger entry and the worker process settled it (mock). A real Razorpay test-mode refund could not be completed locally (no genuine test payment, and webhooks cannot reach localhost); the first real one will be the 2 stuck production tasks after deploy. **Deploy note:** the Razorpay dashboard webhook must also send `refund.processed` and `refund.failed`; without them refunds are still settled by the 30-minute poll.

---

## P1 — will break with real users, or blocks launch

### 5. Workers can't actually be paid

`PAYOUT_PROVIDER` is `none` in production, and the only transfer driver is the mock (`payouts.service.ts`). Earnings and item reimbursements accumulate as "owed" forever. P6's "platform pays the shop by UPI" also depends on this, so production offers only cash bills. **Needs a payout partner (RazorpayX or Cashfree Payouts)**, with its transfer status webhook, before launch.

### 6. Email doesn't send

`EMAIL_PROVIDER=console` in production: verification and password-reset emails go to the container log. Google sign-in works; email/password users can never verify (level 1) or recover their account. Needs a real provider (Resend, SES, or SMTP) and a sending domain.

**Status (2026-10-20): code ready; needs an account.** A Resend driver is in (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on a domain verified in Resend), sent over plain HTTPS and retried by the notification outbox when it fails. What remains is the owner's: a Resend account and a real sending domain (a DuckDNS name cannot carry the DNS records email verification needs), then the three settings in `~/onsite.env` and a restart.

### 7. Login and OTP limits are per IP, and Indian mobile IPs are shared

Login allows 5 attempts per 15 minutes per IP; OTP 3 per hour per IP (`apps/api/src/modules/auth/auth.controller.ts:46`, `:50`). Jio and Airtel put thousands of phones behind one public IP (carrier-grade NAT), so a handful of users mistyping passwords locks out everyone on that tower, and a few OTP requests do the same. The global default (300 requests per minute per IP) has the same problem at scale.

**How large companies do it:** limit per account and per device. Use IP only as a loose secondary signal with high limits, add CAPTCHA or proof-of-work after repeated failures rather than a hard lockout, and use exponential backoff per account.

**Status (2026-10-20): fixed locally, not yet deployed.** Wrong passwords are counted per account (`LoginAttemptsService`, Redis): 5 free, then a wait of 1 minute doubling to 1 hour, cleared by a correct password; the same for addresses with no account, so it reveals nothing. Per-IP limits on auth routes are now a flood guard (300 per 15 minutes); per account 20 per 15 minutes; reset emails 3 per hour per account; OTP send and verify are per signed-in user. The global 300-per-minute default is per user when a token is present, with a new 3,000-per-minute per-IP flood guard behind it. **Verified against the local API, all from one IP:** after 5 wrong passwords the account waited (429, the right password refused too until the wait ended), while 40 sign-ins by 4 other accounts in the same minute all succeeded. **Not done:** CAPTCHA after repeated failures (needs a provider such as Cloudflare Turnstile or hCaptcha).

### 8. Status changes race each other

The accept path is correct: one atomic conditional update decides the winner. Several other paths read the status, check it, then write unconditionally, so a change that lands in between is silently overwritten:

| Path | Unconditional write | What can go wrong |
|---|---|---|
| Requester cancels | `tasks.service.ts:565` | Worker accepts in the same instant: task becomes CANCELLED and is refunded while a worker is assigned and travelling. |
| Deadline expiry (sweeper) | `tasks.service.ts:614` | Worker accepts at the deadline: task EXPIRED and refunded with a worker assigned. `accept` also never checks the deadline itself. |
| Matching starts | `matching/matching.service.ts:110` | Worker accepts from the feed while the first matching pass starts: status goes back to MATCHING with the worker still attached (a corrupt state). |
| Worker taps "On my way" / "Arrived" | `execution.service.ts:81`, `:378` | Requester removes the worker at the same time: task shows "en route" with no worker. |
| Submit (double tap) | `execution.service.ts` submit | Two submissions, two auto-approve jobs, duplicate history. |

**How large companies do it:** every state transition is a compare-and-set (`UPDATE … WHERE id = ? AND status = <expected>`; zero rows means you lost the race), or uses a version column (optimistic locking). One function owns transitions and nothing else writes status.

**Fix:** route every status write through one `transitionTask(taskId, from[], to, extra)` helper that does a conditional update inside a transaction with the history row, and returns "lost the race" rather than writing.

**Status (2026-10-20): fixed locally, not yet deployed.** `writeTransition` / `transitionTask` in `transitions.ts` are now the only task status writers: `UPDATE … WHERE id AND status = <what the caller read>` plus the caller's own conditions (nobody assigned, the same worker still assigned, the deadline passed or not), with the history row in the same transaction and only for the winner. Every path in the table uses it: cancel and expiry require no assigned worker (expiry also a passed deadline), accept requires an unpassed deadline, matching requires no assigned worker, en route / start / arrival / submit require the same worker. Losers get 409 "This task changed a moment ago". **Verified against the local API and Postgres:** 20 rounds of a worker accepting while the requester cancels at the same instant produced all three possible orderings (including the true race, where cancel passed its check and then lost the write) and never both winners or an inconsistent task.

### 9. Money operations can run twice

`refundFull`, `release` and dispute `resolve` each read "is the payment still CAPTURED / dispute still open?" and then write without a condition. Two at once, both book the money:

- Two sweeper ticks overlapping (see #19), or two worker replicas, expiring the same task → refund booked twice.
- Two admins (or one double-click) resolving the same dispute → released or refunded twice.
- Cancel and expiry together → refunded twice.

The ledger still sums to zero (escrow goes negative), so the existing balance check doesn't catch it. Once #4 is fixed, this becomes real money paid twice.

**How large companies do it:** every money movement has an idempotency key with a unique constraint (for example `refund:{taskId}`, `release:{taskId}`) and claims its row with a conditional update before calling the gateway. Escrow balance must never go below zero, enforced in the ledger writer.

**Status (2026-10-20): fixed locally, not yet deployed.** `refundFull` and `release` claim the payment (`CAPTURED` → `REFUNDED`/`RELEASED`) with a conditional update before any ledger entry (with #1). Dispute resolution is claimed first: the dispute moves to RESOLVED only if still open and the task leaves DISPUTED only if still DISPUTED, in one transaction, so a second admin or a double click moves nothing; its money step claims the payment too. And the ledger writer now refuses any group that would take a task's escrow below zero, checked in the same transaction, so a double booking that slips past a caller fails instead of paying twice.

### 10. Multi-step money flows aren't atomic; failures leave stuck tasks

Approval writes COMPLETED, then history, then broadcasts, then releases payment, then updates stats, then notifies: separate statements with no transaction. A crash, deploy or database blip midway leaves, for example, a task COMPLETED with payment still held. Nothing looks for that state, so it stays stuck. Same for cancel→refund, expire→refund, and dispute resolve (money moves first, dispute status is written after).

**How large companies do it:** one transaction for state plus ledger, an outbox for side effects, and **reconciliation sweeps** that look for impossible combinations ("COMPLETED but payment CAPTURED", "EXPIRED but CAPTURED", "DISPUTED with no open dispute") and either repair them or page someone.

**Status (2026-10-20): mostly fixed locally.** Each flow now writes its status (with history) in one transaction, and the money step after it is idempotent. The stranded-money sweep (#1) repairs "EXPIRED/CANCELLED but CAPTURED" and "COMPLETED but CAPTURED"; for a task finished by a dispute it finishes the money the way the admin decided (`DisputesService.settleResolution`), never a plain release. "DISPUTED with no dispute" can no longer happen (#11). A capture's status and its escrow entry are one transaction (#12). Refunds and payouts have their own retrying senders. **Still open:** status and money are not one database transaction (the sweep makes the gap self-healing, not impossible), and a payment released with its ledger write lost mid-way is not detected; that is the ledger reconciliation job (#25).

### 11. A task can be frozen with no dispute

Raising a dispute sets the task to DISPUTED in one statement and creates the dispute record in a separate transaction (`disputes/disputes.service.ts:76` then the transaction below it). If the second step fails, the task is DISPUTED forever with nothing for an admin to resolve, and the escrow is locked. Do both in one transaction.

**Status (2026-10-20): fixed locally.** The freeze (a conditional status write) and the dispute record are one transaction.

### 12. Razorpay webhooks: duplicates and losses

- **Duplicates:** Razorpay retries webhooks, sometimes in parallel. Two deliveries of `payment.captured` can both read `CREATED` and both record the capture (`payments.service.ts:183`–`:205`), doubling escrow on paper. Claim with `updateMany where status != CAPTURED`.
- **Losses:** if a webhook never arrives (server down, misconfigured secret), the payment stays `CREATED` although the customer was charged, and the task never publishes. Nothing polls Razorpay for the order's real status.

Payment companies always run both a webhook handler and a *poller* that fetches pending orders after a few minutes.

**Status (2026-10-20): fixed locally, not yet deployed.** Capture is a conditional claim (`CREATED`/`AUTHORIZED`/`FAILED` → `CAPTURED`) in one transaction with its escrow entry, so parallel deliveries, or the webhook and the poller, record it once. `payment.failed` can only fail a payment not yet captured, so a late failure never undoes a capture. A poller (`PaymentsService.reconcilePending`, every sweeper tick) asks Razorpay about every order still unpaid after 5 minutes (up to 3 days old), task payments and item top-ups, and records a capture it finds exactly as the webhook would.

### 13. The concurrent-task limit is not enforced on accept

`MAX_CONCURRENT_TASKS_PER_WORKER` (3) is only used to filter who gets offers. A worker browsing the feed can accept 20 tasks at once (`tasks.service.ts:661` has no such check), then abandon most. Count active tasks inside the accept transaction.

**Status (2026-10-20): fixed locally.** Accept counts the worker's active tasks (the same four statuses matching uses) inside its transaction, after writing the worker's own profile row, which locks it so two accepts by the same worker take turns. The deadline is checked too. **Verified:** 5 accepts by one worker fired at once, 3 succeeded and 2 were refused.

### 14. One small server

The production machine has 1 GB RAM and 2 vCPUs (Oracle E2.1.Micro). Right now it is using **~930 MB of swap** with almost no traffic. The API, background worker and Redis share it. Under real load Node.js will slow to a crawl on swap or be killed. A restart, Oracle maintenance, or Oracle reclaiming an idle Always Free instance takes the whole product offline. No containers have memory limits.

**How large companies do it:** at least two API instances behind a load balancer, workers on separate machines, managed Redis, autoscaling, and health-based restarts. For OnSite's stage, one paid 2–4 GB VM (or a container platform such as Railway, Fly.io, Render or AWS ECS) plus managed Redis is enough to start.

### 15. Redis loses everything on restart

Production Redis runs with `appendonly no`, `save ""` (no snapshots) and `maxmemory 64mb` with `noeviction`. A restart wipes all delayed matching jobs (tasks stop moving to wider search tiers; only the feed shows them), auto-approve fast-path jobs (the sweeper still covers these), live locations and rate-limit state. When it reaches 64 MB, every write fails, including the rate limiter, which every request goes through.

Fix: turn on AOF persistence, size memory properly, and use a managed Redis or at least a volume plus `appendonly yes`.

### 16. No one is told when something breaks

There is no error tracking (such as Sentry), no uptime monitor, no alert on failed jobs, and no dashboard. Issue #1 has been failing silently in production. At minimum add Sentry (or equivalent) for API and worker errors, an uptime check on `/health/ready`, and an alert on any error-level log from the sweeper or payment code.

**Status (2026-10-20): code ready; needs an account.** With `SENTRY_DSN` set, every error-level log line goes to Sentry (pino hook, errors only, no request bodies or personal data): unhandled request errors, sweep failures, refunds and payouts that gave up, and every "Reconciliation:" finding. What remains is the owner's: a Sentry project (the free tier is enough to start), its DSN in `~/onsite.env`, an alert rule to email or phone, and an uptime check on `https://onsite-api.duckdns.org/health/ready`.

---

## P2 — breaks at scale or can't recover by itself

### 17. Notifications are sent inside the user's request

`NotificationService.notify` (`notifications/notification.service.ts:44`) writes the in-app row, then **waits** for web push and email to send, inside the request that triggered it. Accepting, approving and matching each wait on push and email providers; one slow provider slows every action, and a provider outage turns into timeouts. Matching sends to every offered worker this way.

Standard approach: write the notification row (or outbox event) in the request and let a queue worker deliver push and email with retries and backoff.

**Status (2026-10-20): fixed locally, not yet deployed.** The notification row is the outbox: `notify` writes it with the channels still to send and queues a delivery job (giving up on Redis after 1.5 s); the worker process delivers push and email (`NotificationService.deliver`, 20 at a time), each channel at most once, retrying a failed email with backoff and giving up with a recorded error after 6 attempts; a sweep delivers anything whose job was lost. Migration `20261020150000_notification_outbox`. Every BullMQ call made inside a request (matching, auto-approve, notifications) now gives up after 1.5 s, since the queue connection used to wait for Redis forever. **Verified locally (API and worker):** an accept's notification and a matching wave's pushes were delivered by the worker; with Redis stopped, publish and cancel returned in about 1.5 s and an accept in about 3 s instead of hanging, and the notification it created was delivered within 10 s of Redis returning.

### 18. Matching jobs don't retry and don't run in parallel

Matching jobs use `removeOnFail: true` with no `attempts` (`queue/matching.queue.ts:74`): one database blip and that task's search never widens. The BullMQ workers run with default concurrency 1, so 1,000 tasks published in the morning rush queue one behind another while each offer's 90-second window ticks. Set `attempts` with backoff, raise worker concurrency, and keep failed jobs for inspection.

**Status (2026-10-20): fixed locally.** Tier jobs retry 4 times with exponential backoff from 5 s and failed jobs are kept a week; the matching worker runs `MATCHING_CONCURRENCY` (default 10) passes at once, safe because each pass is idempotent.

### 19. The sweeper can overlap itself

The sweeper is a `setInterval` every 60 s (`tasks/sweeper.service.ts:47`). If a pass takes longer than 60 s (thousands of due tasks, a slow database), the next one starts on top of it, and both act on the same tasks (feeding #9). Each sweep loads every due task with no limit. Fix: one pass at a time (skip if running), batches with `take`, and with more than one worker process, a database advisory lock or a BullMQ repeatable job so only one instance sweeps.

**Status (2026-10-20): fixed locally.** Each sweep runs one pass at a time (a tick that finds the previous pass still running skips it and logs) and takes at most 200 due tasks, oldest first. No cross-instance lock: every action a sweep takes is a compare-and-set or a claimed money move (#8, #9), so two worker replicas acting on one task leave one effect.

### 20. Worker stats lose updates

Completion stats are read, changed in code, and written back (`review.service.ts:219`, also in dispute resolution and leave/remove). Two tasks completing for the same worker at once will lose one count, and completion rate (which feeds matching scores) drifts. Use atomic `increment` and compute the rate in SQL.

**Status (2026-10-20): fixed locally.** `adjustWorkerStats` increments with an atomic update, which locks the profile row, then recomputes the completion rate from the counts in the same transaction; used by approval, dispute settlement, and leave/remove. Ratings are recomputed from the reviews table under the same lock, counting only ratings received as a worker. **Verified against local Postgres:** 20 simultaneous completions for one worker all counted and the rate came out exact.

### 21. Rate limiter edge cases

The counter is `INCR` then `PEXPIRE` as two calls (`common/redis-throttler-storage.ts:50`–`:52`). If the process dies between them, the key never expires and that IP or user stays blocked forever. Use one Lua script or `SET … NX PX` plus `INCR`. Also decide what happens when Redis is down: today every request fails.

**Status (2026-10-20): fixed locally.** The count and its expiry are one `MULTI` with `PEXPIRE … NX`. Rate limiting and the sign-in lock use a separate fail-fast Redis connection (no offline queue, 500 ms command timeout) and fail open with a warning. Every Redis connection now logs one line a minute while disconnected, where ioredis used to print a stack trace per reconnect attempt. **Verified:** with the local Redis stopped, sign-in answered in 56 ms and an authenticated read in 9 ms, and the API recovered by itself when Redis returned.

### 22. Sockets outlive their sessions

The socket checks the access token once at connect (`realtime/realtime.gateway.ts:65`). A suspended user, or one who changed their password (which bumps `tokenVersion`), keeps receiving live task events until they disconnect. Check `tokenVersion` and status at connect, and disconnect a user's sockets on suspension or sign-out.

**Status (2026-10-20): fixed locally, not yet deployed.** At connect the socket now gets the same checks as an HTTP request (account active, token version current), and it is ended when its access token expires, with `session:expired` so the client refreshes and reconnects. Suspension, password reset and account deletion end the user's sockets on every instance (`RealtimePublisher.disconnectUser`) with `session:revoked`, so the client stays disconnected. The frontend reconnects after an expiry (Socket.IO does not on its own when the server ends a socket). **Verified locally with a real Socket.IO client:** a bad token was told to refresh; suspending an account cut its live socket within a second; its old token was refused on reconnect.

### 23. Free public map tiles and geocoder

The frontend loads tiles from `tile.openstreetmap.org`, and the API geocodes through `photon.komoot.io`. OpenStreetMap's tile usage policy forbids heavy app traffic, and Komoot's Photon is a fair-use demo. At thousands of users both will throttle or block you. Use a tile provider (MapTiler, Stadia, Protomaps self-hosted on R2) and a paid or self-hosted geocoder.

### 24. Free tiers and their terms

| Service | Limit that matters |
|---|---|
| Neon free | small storage and compute quota, compute sleeps when idle (cold-start latency), short history for point-in-time restore |
| Oracle Always Free | 1 GB VM; idle instances can be reclaimed |
| DuckDNS (`onsite-api.duckdns.org`) | free dynamic DNS, no SLA; your API's address depends on it |
| Vercel Hobby | personal, non-commercial use only under its terms |

Fine for a demo; for a paid launch, move to paid plans with backups and a domain you own.

### 25. No ledger reconciliation

`docs/11` says a periodic job checks that every task's ledger sums to zero; none exists. Today's production ledger does balance (checked: 0 unbalanced tasks), but that was checked by hand. Add a nightly job that checks sums, checks that no escrow is negative, compares captured and refunded amounts with Razorpay settlement reports, and alerts on any difference. Payment companies treat this daily reconciliation as non-negotiable.

**Status (2026-10-20): fixed locally, not yet deployed.** `ReconciliationService` runs hourly in the worker and on demand at `GET /admin/reconciliation`. It reports, as error log lines starting "Reconciliation:", any task whose ledger does not sum to zero, escrow below zero, escrow left after a payment settled, a captured payment never booked into escrow, a booked refund without matching gateway refunds, refunds or payouts that gave up or sit unsettled for 2 days, and, for Razorpay payments of the last 48 hours, any difference from Razorpay in status, amount or refunds. It changes nothing. **Verified locally:** clean over 113 tasks; a planted stray escrow entry was reported as both an unbalanced ledger and money left after settlement. **Not covered:** Razorpay settlement reports (what reached the bank), which need the settlements API and someone in finance to own them.

### 26. Logs and health checks

Container logs use Docker's default with no size limit; on a 45 GB disk (58% used) they will eventually fill it. Set `max-size`/`max-file`. The `onsite-worker` container reports **unhealthy** because its health check calls `http://localhost:4000/health`, but the worker has no HTTP server. It's a false alarm, but it trains everyone to ignore health status. Give the worker its own check (for example a heartbeat key in Redis).

**Status (2026-10-20): fixed in the repo; applied at the next deploy.** The worker touches a heartbeat file every sweeper tick and the image's HEALTHCHECK reads it when `ROLE=worker` (healthy within 3 minutes of a tick), keeping the HTTP check for the API. **Verified:** exit 0 with a live worker, 1 with no heartbeat. The production commands, now written down in docs/21's "Production runbook", run every container with `--log-opt max-size=10m --log-opt max-file=5`, and Redis with persistence (#15).

---

## P3 — hygiene

### 27. Data that only grows

Uploaded proofs and bill photos are never deleted from storage, including proofs removed when a worker leaves a task. `notifications`, `messages`, `task_offers`, `task_status_history` and `webhook_events` have no retention policy. Add retention jobs and storage lifecycle rules (R2 supports them).

**Status (2026-10-20): fixed locally, not yet deployed.** When proof rows are removed (a worker leaves or is removed, or deletes a proof), their storage keys are queued in the same transaction (`storage_deletions`, migration `20261020170000_storage_deletions`), and `RetentionService` (daily, in the worker) deletes the objects. It also deletes read notifications after 180 days and all after a year, webhook records after 180 days, used or expired one-time codes after 30 days, refresh tokens 30 days after expiry, and offers on finished tasks after a year. **Decided 2026-10-20 under the founder's delegation (to be confirmed by a lawyer; docs/06 "Data retention"):** money records (payments, ledger, refunds, payouts, item bills, disputes) at least 8 years; status history and audit records with them; chat and proof of a finished task 1 year after it closed, 3 years if disputed, then deleted with their files. **Verified locally:** an uploaded file queued for deletion was gone from storage after the job. **Still to do outside the code:** a storage lifecycle rule for uploads that were presigned but never recorded.

### 28. Status writes everywhere

`CLAUDE.md` says task status writes live only in `transitions.ts`. In practice they are in `tasks.service.ts`, `execution.service.ts`, `review.service.ts`, `matching.service.ts`, `disputes.service.ts` and `payouts.service.ts`. That is what makes #8 possible. One helper (see #8) restores the rule.

**Status (2026-10-20): fixed locally with #8.** Every task status write goes through `writeTransition`.

### 29. No working CI

CI on `main` has failed since September (Prisma client not generated before seeding), so nothing stops a broken commit, and pushing `owl-frontend` deploys the frontend straight to production. Fix CI and require it to pass before deploying.

**Status (2026-10-20): fixed in the repo.** The workflow now generates the Prisma client before seeding, uses Node 22, and runs on `owl-frontend` as well as `main`. **Verified locally:** the 14 migrations applied to an empty database, the seed completed, and all 349 API tests passed against it. **Still needs the owner:** GitHub branch protection requiring the CI check on `owl-frontend` and `main`; Vercel then waits for it before a production deploy only if its "Ignored Build Step" or required checks are set, which is a project setting.

### 30. Item bills (P6)

A "shop" UPI ID could be a colluding worker's or requester's personal ID. The payout partner's account-name check on the UPI ID would catch most of these. GST/TCS/TDS on item money passing through the platform needs a chartered accountant's confirmation.

---

## Business and compliance

Not code, but things that can stop a launch:

1. **Holding customer money.** Holding funds in escrow and paying them out later needs either a licensed payment aggregator's escrow or nodal product (for example Razorpay Route or an escrow account) or an RBI authorisation. Confirm the structure in writing with Razorpay.
2. **DPDP Act 2023.** Consent records, a published privacy notice, data deletion on request (account deletion exists), a grievance officer, and breach notification. Aadhaar-related data (even the last 4 digits) needs a clear purpose and retention period.
3. **Tax.** GST on the commission, TCS/TDS for e-commerce operators (section 194-O), and the treatment of item money. All rates are 0 in config, pending an accountant.
4. **Cancellation and refund policy** after a worker is assigned is still undecided (`ai/memory.md`, open questions); today post-assignment cancellation is simply blocked.

---

## Suggested order

1. **Now (P0):** fix the broadcast crash (#1, #2), refund the 2 stuck production tasks, freeze the price once paid (#3).
2. **Before real money:** real Razorpay refunds (#4), idempotent money operations (#9), atomic flows and reconciliation sweeps (#10, #25), webhook dedupe and polling (#12), conditional status transitions (#8, #11, #28).
3. **Before launch:** payout partner (#5), email (#6), per-account login limits (#7), accept cap (#13), monitoring (#16), bigger server and persistent Redis (#14, #15).
4. **Before scale:** queued notifications (#17), matching retries and concurrency (#18), sweeper locking (#19), atomic stats (#20), map and geocoding providers (#23), paid hosting (#24), log and data retention (#26, #27), CI (#29).
