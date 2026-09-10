# 05 — System Architecture

## Shape

```
                    ┌─────────────────────────────┐
                    │   apps/web  ·  Next.js      │
                    │  marketing · requester ·    │
                    │  worker · admin · PWA       │
                    └──────────────┬──────────────┘
                                   │ HTTPS REST + WebSocket
                                   ▼
                    ┌─────────────────────────────┐
                    │   apps/api  ·  NestJS       │
                    │  controllers → services →   │
                    │  repositories               │
                    └──────────────┬──────────────┘
                                   │
     ┌──────────────┬──────────────┼──────────────┬──────────────┐
     ▼              ▼              ▼              ▼              ▼
┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│Postgres │   │  Redis   │   │  Object  │   │ Razorpay │   │  Google  │
│+PostGIS │   │ cache +  │   │ storage  │   │  Route   │   │  Places  │
│         │   │  BullMQ  │   │ S3/MinIO │   │          │   │          │
└─────────┘   └────┬─────┘   └──────────┘   └──────────┘   └──────────┘
                   │
                   ▼
          ┌──────────────────┐
          │  worker process  │   matching fan-out · radius expansion
          │  (same codebase, │   auto-approve · notifications · sweeper
          │   ROLE=worker)   │
          └──────────────────┘
```

Media never crosses the API. The browser uploads directly to object storage with a presigned URL and the API records only metadata.

## Processes

Two runtimes from one codebase, selected by a `ROLE` environment variable.

| Role | Responsibility |
|---|---|
| `api` | HTTP requests and WebSocket connections. Stateless, horizontally scalable |
| `worker` | BullMQ consumers and scheduled sweepers. No HTTP surface |

They are separated so a burst of matching fan-out cannot slow request handling, and so each can scale on its own signal.

## Stack

| Layer | Technology | Note |
|---|---|---|
| Monorepo | pnpm workspaces, Turborepo | |
| Web | Next.js App Router, TypeScript, Tailwind, shadcn/ui, Framer Motion | Server Components by default |
| PWA | Service worker, Web Push with VAPID | Install prompt is part of worker onboarding |
| API | NestJS, REST | Modules by domain |
| Auth | JWT access tokens, rotating refresh tokens | |
| Database | PostgreSQL 16 with PostGIS | |
| ORM | Prisma | Spatial SQL quarantined, see below |
| Cache and jobs | Redis, BullMQ | |
| Realtime | Socket.IO with the Redis adapter | Any instance serves any socket |
| Storage | S3-compatible, presigned uploads | MinIO locally |
| Payments | Razorpay Route | Behind a provider interface |
| Geocoding | Google Places and Geocoding | Behind a provider interface |
| Map display | MapLibre GL with OpenStreetMap tiles | Keeps the Google quota for geocoding |

## Layout

```
apps/
  web/                      Next.js
    app/(marketing)/        public pages
    app/(app)/              authenticated requester and worker
    app/(admin)/            admin console
    components/ui/          design system primitives
    lib/api/                typed API client
  api/
    src/modules/            auth, users, workers, tasks, proofs, matching,
                            payments, chat, notifications, disputes, admin
    src/repositories/       data access, including geo.repository.ts
    src/jobs/               BullMQ processors and sweepers
    prisma/                 schema and migrations
packages/
  types/                    shared TypeScript types
  validation/               shared Zod schemas
  money/                    currency and fee arithmetic
  utils/                    shared helpers
infra/
  docker/                   Dockerfiles
  k6/                       load tests
docs/  ai/  prompt.md
```

`packages/*` must not import Node built-ins or assume a DOM, so a React Native app can consume them later.

## Request path

```
Request
  → rate limiter
  → auth guard          (valid token?)
  → roles guard         (right role?)
  → validation pipe     (Zod schema from packages/validation)
  → controller          (thin: one service call)
  → service             (business logic, authorization on this specific resource)
  → repository          (Prisma, or geo.repository for spatial)
  → projection          (explicit allow-list, never a raw entity)
Response
```

Authorization is checked twice by design: the guard confirms the caller has the role, the service confirms the caller may act on **this** resource. Only the second stops one requester reading another's task.

## Three quarantined concerns

Centralized so they cannot drift. Enforced by review and by lint rules.

| Concern | The only place it lives | Why |
|---|---|---|
| Task status writes | `modules/tasks/transitions.ts` | The state machine is meaningless if any service can set a status directly |
| Raw PostGIS SQL | `repositories/geo.repository.ts` | Prisma has no geography type. Raw SQL is acceptable contained, dangerous scattered |
| Money movement | `modules/payments/ledger.service.ts` | Every rupee must produce balanced ledger rows. One writer makes that enforceable |

## Prisma and PostGIS

Prisma has no native geography type; PostGIS columns map to `Unsupported`. Consequences, accepted deliberately:

- Geography columns are declared `Unsupported("geography(Point, 4326)")` in the schema so Prisma manages them in migrations without reading them.
- GIST indexes and the PostGIS extension are created in hand-written SQL migrations.
- Every spatial read goes through `geo.repository.ts` using `$queryRaw` with typed return shapes and parameterized inputs. No string interpolation into SQL, ever.
- Latitude and longitude are stored as ordinary columns alongside, for display and serialization. **They are never used for proximity arithmetic.** Distance comes from PostGIS.

## Background jobs

| Job | Trigger | Purpose |
|---|---|---|
| `task.match` | Task published | Rank workers, create offers, notify the top tier |
| `task.expandRadius` | Delayed, per tier | Widen the search when nobody accepts |
| `task.expire` | At deadline | Expire an unaccepted task and refund |
| `task.autoApprove` | At `review_deadline_at` | Approve and release when the requester is silent |
| `notification.dispatch` | Event | Push, email, in-app |
| `payout.process` | On release | Initiate the worker transfer |
| `sweeper.reviewDeadlines` | Every 60s | Catch auto-approvals whose queue job was lost |
| `sweeper.stuckPayouts` | Every 5m | Retry payouts stuck in processing |

**The sweepers are not redundancy for its own sake.** A delayed job living only in Redis means a Redis incident can silently cause a worker never to be paid, and nobody finds out until they complain. Deadlines live in database columns; the queue is the fast path and the sweeper is the guarantee.

## Environments

| Environment | Database | Cache | Storage | Payments |
|---|---|---|---|---|
| Local | Docker Postgres and PostGIS | Docker Redis | MinIO | Mock driver |
| Staging | Managed Postgres | Managed Redis | Object storage bucket | Razorpay test mode |
| Production | Managed Postgres, PgBouncer | Managed Redis | Object storage bucket | Razorpay live |

Configuration is validated by schema at startup. A missing or malformed variable stops the process from booting rather than surfacing as a failure later.

## Explicitly not in the architecture

Recorded so they are not introduced by accident:

- No microservices. One API, modular inside. Service boundaries at this stage cost more than they give.
- No GraphQL. REST with typed clients is enough and simpler to secure and rate limit.
- No read replicas, sharding, or multi-region. Out of scope at this scale.
- No server-side session store. Tokens only, so the API stays stateless.
- No direct database access from the web app under any circumstances.
