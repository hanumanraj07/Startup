# OnSite

A two-sided marketplace for remote physical tasks in India. Someone who cannot be at a place pays a verified person who is already there to do a physical task and prove it was done.

## Read these first

Before writing any code in this repository:

1. **`ai/project-context.md`** — what OnSite is and the invariants that must not be broken.
2. **`ai/architecture-rules.md`** — the architectural constitution.
3. **`ai/coding-rules.md`** — code standards.
4. **`ai/task-generation-rules.md`** — how to work here.
5. **`ai/memory.md`** — what has already been decided and rejected. Check this before proposing an architectural change.

Then read the specific `docs/` file governing the area you are changing. `docs/` is the source of truth for product rules. Do not infer them from code.

## The invariants, in short

- Matching runs from **task location to worker location**, never requester location.
- The **server** decides task state, payment state, and prices. Clients request; they do not assert.
- **Client GPS is evidence to be verified**, never fact.
- **Money never moves on trust**: funds are captured before a task is visible, held, released on approval.
- **Personal data never crosses** the requester and worker boundary. No phone numbers, no email addresses, no home addresses.
- **Every rupee is double-entry** and a task's ledger must sum to zero.
- Launch scope is **remote inspection and verification, Ahmedabad and Kolkata only**.

## Centralized concerns

| Concern | The only place it lives |
|---|---|
| Task status writes | `apps/api/src/modules/tasks/transitions.ts` |
| Raw PostGIS SQL | `apps/api/src/repositories/geo.repository.ts` |
| Money movement | `apps/api/src/modules/payments/ledger.service.ts` |
| Fee and split arithmetic | `packages/money` |

## Stack

Next.js App Router with TypeScript, Tailwind and shadcn/ui, installable as a PWA. NestJS REST API. PostgreSQL with PostGIS via Prisma. Redis with BullMQ. S3-compatible object storage with presigned direct uploads. Razorpay Route for escrow. Google Places for geocoding, MapLibre with OpenStreetMap for display. Socket.IO with the Redis adapter for realtime.

## Repository layout

```
apps/web          Next.js — marketing site, requester app, worker app, admin
apps/api          NestJS — REST API, background workers
packages/types    Shared TypeScript types
packages/validation  Shared Zod schemas
packages/money    Currency and fee arithmetic
packages/utils    Shared helpers
docs/             Product and technical specification, the source of truth
ai/               Rules and decision log for AI-assisted development
infra/            Docker, deployment, load tests
prompt.md         The original founder document. History and rationale, not a live spec.
```

`packages/*` must stay free of Node built-ins and DOM assumptions so a native app can consume them later.

## Commands

```bash
pnpm install
docker compose up -d          # Postgres + PostGIS, Redis, MinIO
pnpm db:migrate               # apply migrations
pnpm db:seed                  # Ahmedabad and Kolkata demo data
pnpm dev                      # web on :3000, api on :4000
pnpm test
pnpm typecheck && pnpm lint
pnpm demo:reset               # rebuild the full demo scenario
```

Docker Desktop must be running before `docker compose up`.

## When something is unclear

Raise it rather than resolving it silently in code. A rule decided implicitly inside an implementation is a rule nobody can find later.
