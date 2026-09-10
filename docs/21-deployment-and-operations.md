# 21 — Deployment and Operations

What Phase 10 actually proved, and the exact sequence a deploy follows. Every command below was run against the real local stack while writing this file, not copied from a template.

## Container image

One image, `apps/api/Dockerfile`, serves both processes from docs/05-system-architecture.md — `ROLE=api` for HTTP/WebSocket, `ROLE=worker` for the BullMQ consumers and sweeper. Build from the **repo root**, not `apps/api/`, because this is a pnpm workspace and the image needs the whole monorepo to resolve `packages/*`:

```bash
docker build -f apps/api/Dockerfile -t onsite-api:<tag> .
```

**A real trap, found by actually building this, not by inspection**: `RUN pnpm install` in the dependency-install stage triggers `@prisma/client`'s own postinstall generate — but at that point in the multi-stage build only `package.json` files exist, not `prisma/schema.prisma` (deliberately, so the install layer stays cached across source-only changes). That silently produces an empty stub Prisma client with no `User`, `Task`, `Prisma.sql`, or any other real type. Running `nest build` against that stub fails with 76 TypeScript errors that look like unrelated implicit-`any` and missing-export problems and have nothing to do with the application code. The fix is ordering: `prisma generate` must run again, explicitly, after the real schema is copied in and before `nest build` — see the Dockerfile's own comment at that exact line.

Verified live: built the image, ran it with `ROLE=api` against the real `docker-compose` Postgres/Redis/MinIO on `startup_default`, hit `/health/ready` from the host and got a real `{"status":"ready","checks":{"database":true}}`; ran the identical image again with `ROLE=worker` and watched it pick up and correctly process a real leftover queued matching job. Also confirmed the image genuinely refuses to boot with `NODE_ENV=production` and the mock payment provider — the same env-validation guard from `config/env.ts` holding inside the container, not just in local `pnpm dev`.

## Environment

Every variable in `.env.example`, validated at startup by `config/env.ts` — the process refuses to boot on missing or malformed configuration. Never bake secrets into the image; inject them at container start (environment variables, a secrets manager, or an orchestrator's secret mounts).

## Minimal deployment shape

Matches docs/20-scalability-performance.md's connection-pool arithmetic and docs/05's process split:

| Component | Count at launch | Notes |
|---|---|---|
| API container (`ROLE=api`) | 1–3 | Stateless; add replicas behind a load balancer as traffic grows |
| Worker container (`ROLE=worker`) | 1 | Scale only if queue depth grows sustained — see docs/20's scaling posture table |
| PostgreSQL 16 + PostGIS | 1 (managed) | The `onsite_app` database, created from `template0`, owning exactly the `postgis` extension it creates itself — see `ai/memory.md`'s note on why |
| Redis | 1 (managed) | BullMQ, rate-limit storage (`RedisThrottlerStorage`), Socket.IO adapter |
| Object storage | S3-compatible (MinIO locally, a managed bucket in production) | |

Readiness (`/health/ready`, checks database) gates traffic; liveness (`/health`, no dependency checks) does not — a brief Redis blip should not restart an otherwise-healthy container, exactly as docs/20 specifies.

## Backup and restore

**Verified live**, not asserted: took a real `pg_dump`, restored it into a fresh database, and confirmed exact row counts and the `unbalanced_tasks` ledger-integrity view still returned zero rows afterward.

```bash
# Backup (custom format — supports parallel restore and selective restore)
docker exec onsite-db pg_dump -U onsite -d onsite_app -F c -f /tmp/onsite_backup.dump

# Restore into a fresh database — PostGIS must be created before restoring,
# since restored objects (the generated geography columns) depend on it.
docker exec onsite-db createdb -U onsite -T template0 <restore_target>
docker exec onsite-db psql -U onsite -d <restore_target> -c "CREATE EXTENSION IF NOT EXISTS postgis;"
docker exec onsite-db pg_restore -U onsite -d <restore_target> --no-owner --no-privileges /tmp/onsite_backup.dump

# Verify: row counts should match the source exactly, and the ledger
# integrity view must still report zero rows.
docker exec onsite-db psql -U onsite -d <restore_target> -t -c "SELECT count(*) FROM unbalanced_tasks;"
```

In production: automate this on a schedule against the managed Postgres provider's own backup mechanism where available (most support point-in-time recovery natively), encrypt backups at rest per docs/16, and **run the restore step for real on a recurring basis** — docs/16's own words: "an untested backup is a hope rather than a backup."

## Load testing

k6 scripts for the four scenarios from docs/20-scalability-performance.md live in `infra/k6/`. **Honestly not run in this environment**: k6 is not installed here, and docs/20 itself says to run these "against a staging environment sized like production, not against a laptop." The scripts are real and ready to run, not placeholders — see each file's own comment for what it checks and how to interpret a failure.

The one load-bearing claim from that scenario list that **was** proven directly, without k6, because it is the single most important one: docs/20's accept-herd scenario ("50 workers accepting the same task simultaneously... exactly one 200 and forty-nine 409 every time. Zero double assignments") was run for real — 50 genuinely concurrent HTTP requests, real database, real atomic `updateMany` — repeatedly, with the database checked after every repetition. See `ai/memory.md`'s entry on the rate-limiting fix this same run surfaced.

## Security pre-launch checklist

Walking docs/16-security-requirements.md's own list, honestly:

| Item | Status |
|---|---|
| Dependency audit clean of high-severity findings | Not run in this session — needs `pnpm audit` wired into CI, which does not exist yet (no CI pipeline is configured in this repo) |
| Every endpoint confirmed to have authentication and authorization | JwtAuthGuard is global and secure-by-default (`@Public()` opts out, not in); AdminGuard on every `/admin` route. Not exhaustively re-audited route-by-route in this pass |
| PII projection tests passing across all cross-party responses | `tasks.service.pii.test.ts` covers the highest-value case (task detail, both role projections) with an exact key-set assertion. Chat's redaction is covered separately (`redaction.test.ts`). Not yet extended to every cross-party endpoint (e.g. worker public profile) |
| Rate limits verified under load | Yes — see the accept-herd finding above, which is exactly this, live |
| Webhook signature verification tested, including a forged signature | **Not applicable yet**: no real payment webhook exists (Razorpay is mock-only, honestly, throughout this project — see Phase 6) |
| Idempotency verified by replaying every money operation | Payment order creation's idempotency key is unit- and live-tested (Phase 4/6). Not exhaustively replayed for every money-moving operation in this pass |
| Secrets confirmed absent from the repository history | No commit has been made this session (by explicit instruction) — nothing to audit yet in history. `.env` is gitignored; verified present in `.gitignore` |
| Backup restore performed successfully | **Yes — see above, verified live in this session** |
| TLS and security headers verified in the deployed environment | Headers verified locally (CSP, HSTS, X-Frame-Options: DENY, Permissions-Policy, all live-checked via `curl -D -`). TLS itself is a deployment-environment concern (terminated at a load balancer or reverse proxy) — not applicable to local verification |
| Admin access limited to known accounts with audit logging confirmed working | `platform_role = ADMIN` is only ever set by direct database action (docs/15). Audit logging live-verified in Phase 9 (dispute resolution, KYC decision, suspension all wrote real audit rows with actor, IP, before/after) |
