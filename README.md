# OnSite

**Someone on the ground, wherever you need them.**

A two-sided marketplace for remote physical tasks in India. Someone who cannot be at a place pays a verified person who is already there to do a physical task and prove it was done.

## The problem

You live in Ahmedabad. You want to buy a MacBook Air from a specific shop in Kolkata, but you want it physically inspected first: is the model actually in stock, is the box sealed, what is the real serial number, what is the final price?

Your options today are to travel there, hope you know someone free in Kolkata, hire an agency priced for corporate work, or trust a stranger with no verification and no recourse. All of them are bad.

## How it works

```
Requester · Ahmedabad                      Worker · Kolkata
        │                                          │
        │ posts a task at a Kolkata location       │
        │ pays ₹500, held in escrow                │
        ▼                                          │
   ┌─────────────────────────────────────┐         │
   │              OnSite                 │         │
   │  location matching · proof · escrow │────────►│  sees it, 3 km away
   │  trust · disputes                   │         │  accepts, visits
   └─────────────────────────────────────┘         │  uploads photos, video,
        │                                          │  serial number, GPS
        │ reviews the evidence, approves           │
        ▼                                          ▼
   ₹75 platform commission              ₹425 released to the worker
```

The essential detail: **a task has two locations.** The requester is in Ahmedabad, the work happens in Kolkata, and matching runs from the *task* location to nearby workers. That is the whole product in one sentence.

## What makes it work

| | |
|---|---|
| **Matching** | PostGIS radius search, scored on distance, rating, completion rate and category experience. Nearest does not win; best match does |
| **Proof** | Photos, video and structured fields with GPS distance measured server-side and timestamps recorded. Evidence, not assertions |
| **Escrow** | Funds captured before a task is ever visible to a worker, released on approval, auto-released after 24 hours, frozen on dispute |
| **Trust** | Five verification levels, with requirements scaling to what is at stake |

## Status

**Phase 1 of 10: the specification layer is complete.** No application code yet, deliberately. The specifications came first so the architecture and business rules are settled before implementation, rather than being re-invented in every coding session.

See `TODO.md` for the build queue and the plan's phase list.

## Start here

| If you want to | Read |
|---|---|
| Understand the product | `docs/01-product-requirements.md` |
| Write code here | `CLAUDE.md`, then `ai/project-context.md` |
| Know what is in scope | `docs/17-mvp-scope.md` |
| Know why something was decided | `ai/memory.md` |
| See the original idea | `prompt.md` — history and rationale, not a live spec |

`docs/` is the source of truth for product rules. Where `prompt.md` disagrees with `docs/`, `docs/` wins.

## Stack

Next.js with TypeScript, Tailwind and shadcn/ui, installable as a PWA. NestJS REST API. PostgreSQL with PostGIS via Prisma. Redis with BullMQ. S3-compatible storage with presigned direct uploads. Razorpay Route for escrow. Google Places for geocoding, MapLibre with OpenStreetMap for display. Socket.IO with the Redis adapter.

One web codebase serves the marketing site, the requester app, the worker app and the admin console.

## Development

Requires Node 20+, pnpm, and Docker Desktop running.

```bash
pnpm install
cp .env.example .env
docker compose up -d      # Postgres + PostGIS, Redis, MinIO
pnpm db:migrate
pnpm db:seed              # Ahmedabad and Kolkata demo data
pnpm dev                  # web :3000, api :4000
```

Everything runs offline. Payments default to a mock provider, OTPs print to the console, and map tiles need no key. No third-party account is needed to develop or test the full flow.

## Launch scope

Deliberately narrow: **remote inspection and verification, in Ahmedabad and Kolkata only.**

Not "any task, anywhere." A broad launch invites fraud, prohibited tasks and safety incidents before the marketplace has the liquidity to survive them. Expansion is planned in `docs/18-future-roadmap.md` and gated on completion rate, time to match and dispute rate.

## License

Private. All rights reserved.
