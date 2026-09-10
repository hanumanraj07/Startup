# 20 — Scalability and Performance

Target: **1,000+ concurrent users from launch.**

## What that number actually demands

Being honest about it, because the honesty determines where effort goes.

A thousand concurrent users on a task marketplace is a modest load. Most are idle or reading. A realistic peak profile:

| Activity | Share | Load |
|---|---|---|
| Workers browsing the feed | ~60% | 30–60 requests/sec |
| Requesters checking status | ~25% | 10–20 requests/sec |
| Active task execution and chat | ~10% | 200–400 WebSocket connections |
| Task creation and payment | ~5% | 1–3 requests/sec |

A single well-configured Node instance handles this. **The risk is not request volume. It is a short list of specific mistakes**, each of which turns a modest load into an outage. The engineering below is about not making them, not about exotic scale.

Explicitly out of scope, and it would be over-engineering today: sharding, read replicas, multi-region, CQRS, event sourcing, a service mesh.

## The five mistakes, and how each is avoided

### 1. Media through the API

Proof video uploaded through NestJS would saturate the API before anything else. A single 50 MB video occupies a request for its entire duration; a dozen concurrent uploads exhausts the event loop and every other user waits.

**Avoided by:** presigned direct upload. The browser uploads straight to object storage. The API issues a short-lived URL and records metadata afterwards. **The API never sees a byte of media.** This is an architectural rule, not an optimization.

### 2. Chat by polling

A thousand clients polling every two seconds is 500 requests per second of pure waste, more than the entire real workload.

**Avoided by:** Socket.IO with the Redis adapter. Messages are pushed. The Redis adapter means any API instance can serve any socket, so scaling stays horizontal.

### 3. Connection pool exhaustion

The usual cause of a Node API falling over is not CPU. It is every replica opening a large pool against a Postgres with `max_connections = 100`, and the pools together exceeding it.

**Avoided by:** explicit pool arithmetic, written down.

```
max_connections            100
reserved (admin, migration) 10
available                   90

per API replica pool        20
API replicas                 3   → 60
worker process pool         15   → 15
                                 ───
                          total  75  ✓ under 90
```

Beyond three replicas, **PgBouncer in transaction mode** goes in front, so application pools can grow while server-side connections stay small. The arithmetic is revisited whenever replica count changes, and this table is updated when it does.

### 4. Unindexed spatial queries

`ST_DWithin` over a growing worker table without a GIST index degrades from milliseconds to seconds as supply grows, and it degrades exactly when the marketplace is starting to work.

**Avoided by:** GIST indexes on every geography column, partial indexes on the open-task feed so only open tasks are scanned, hard result limits, and pagination. Verified by `EXPLAIN ANALYZE` in tests asserting index scans rather than sequential scans, **against 10,000 seeded workers**. Testing a geo index against thirty rows proves nothing.

### 5. Synchronous fan-out

Ranking and notifying fifty workers inside the request that created a task makes task creation slow and couples it to the push service being healthy.

**Avoided by:** the request returns as soon as the task is persisted. Matching, ranking, notification and radius expansion all run in the separate worker process via BullMQ.

## Caching

Redis, with explicit invalidation. Cached only where reads greatly outnumber writes.

| Cached | TTL | Invalidated on |
|---|---|---|
| Categories | 1 hour | Admin edit |
| Cities | 1 hour | Admin edit |
| Worker public profile card | 5 minutes | Rating or completion change |
| Price hints by category and city | 1 hour | Recomputation job |
| Rate limit counters | window | — |

**Not cached:** task status, payment state, the nearby feed, anything a user acts on. Serving a stale task status causes two workers to travel to one task. Caching correctness-critical state to save a query is a bad trade.

## Query discipline

- **Every list endpoint is cursor-paginated.** No endpoint returns an unbounded collection.
- No N+1. Relations loaded explicitly. Enforced by review and by query-count assertions in tests on the hot paths.
- Every hot query has an index that exists for it by name, listed in `docs/06-database-design.md`.
- `pg_stat_statements` enabled, and the slowest queries reviewed before each release.
- Slow query log at 200ms.

## Background work

Separate process, scaled independently, so a fan-out burst cannot slow request handling.

| Queue | Concurrency | Note |
|---|---|---|
| `task.match` | 5 | CPU-light, database-bound |
| `notification.dispatch` | 20 | Network-bound, safe to parallelize |
| `payout.process` | 3 | Deliberately low. Money operations are not rushed |
| `sweepers` | 1 | Serial by design |

Every job is idempotent, since BullMQ can redeliver. Failures retry with exponential backoff and land in a dead letter queue that is monitored rather than ignored.

## Realtime

Socket.IO with the Redis adapter, one room per task, membership authorized on connection.

Budget roughly 400 concurrent sockets at the 1,000-user target. Sockets are cheap; the cost is in broadcast fan-out, which is bounded because a task room holds two people and an admin at most.

**Verified with two API instances running**, a requester connected to one and a worker to the other, confirming messages cross. Without the Redis adapter this fails silently in production and works perfectly in single-instance development, which is exactly why it is a test.

## Scaling posture

The API and worker processes are **stateless**: no in-memory sessions, no local file storage, no per-instance caches that would make replicas disagree. Scaling is adding containers.

| Signal | Action |
|---|---|
| API p95 latency > 500ms | Add an API replica |
| Queue depth growing | Add a worker replica |
| Database connections > 70% | Add PgBouncer, review pool sizes |
| Database CPU > 70% sustained | Review slow queries first, resize second |
| Storage or bandwidth | Managed, scales itself |

Health checks: `/health` for liveness with no dependency checks, `/health/ready` for readiness checking database, Redis and storage. Only readiness gates traffic, so a brief Redis blip does not restart healthy containers.

## Load testing

Assumption-free verification with k6. Four scenarios, each testing something that could realistically break.

| Scenario | Setup | Pass condition |
|---|---|---|
| **Feed storm** | 1,000 virtual users browsing the nearby feed against 10,000 seeded Kolkata workers | p95 < 250ms, index scans only, no pool exhaustion |
| **Accept herd** | 50 workers accepting the same task simultaneously, repeated 100 times | Exactly one `200` and forty-nine `409` every time. **Zero double assignments** |
| **Lifecycle soak** | Full task lifecycles sustained for 30 minutes | Flat memory, connections stable, **ledger balances to zero for every task** |
| **Upload burst** | 100 concurrent presign requests and direct uploads | API p95 < 150ms and flat API memory, proving media genuinely bypasses the API |

The accept herd is the most important. A double assignment means two people travelled to one task and one of them worked for nothing, which is the kind of failure a worker never forgives.

Run against a staging environment sized like production, not against a laptop.

## Monitoring

| Signal | Alert |
|---|---|
| API p95 latency | > 500ms for 5 minutes |
| Error rate | > 1% |
| Queue depth | > 1,000 |
| Failed payouts | Any |
| **Ledger imbalance** | **Any. Treated as an incident, not a warning** |
| Database connections | > 80% |
| Redis memory | > 80% |
| Auto-approvals fired by the sweeper rather than the queue | Any sustained rate, since it means the queue is dropping jobs |

Structured JSON logs with a correlation identifier per request. Error tracking with release tagging so a regression is attributable to a deploy.

## Cost at this scale

Roughly, monthly, at launch volume:

| Item | Estimate |
|---|---|
| API and worker hosting | $20–40 |
| Managed Postgres with PostGIS | $20–50 |
| Managed Redis | $10–20 |
| Object storage and bandwidth | $5–20 |
| Web hosting | $0–20 |
| Google Maps geocoding | $0 within the free tier |
| Error tracking | $0–26 |
| **Total** | **roughly $55–175** |

A thousand concurrent users does not require expensive infrastructure. It requires not making the five mistakes above.
