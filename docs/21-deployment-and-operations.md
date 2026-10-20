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

## Production runbook (current single VM)

Written down 2026-10-20 (docs/22, #26) so a deploy does not depend on anyone's memory. Production today is one Oracle VM (`ubuntu@onsite-api.duckdns.org`, SSH key `infra/oracle-instance.pem`, never committed), with Caddy on the host serving `onsite-api.duckdns.org` and proxying to `localhost:4000`. The API and the worker are the same image with a different `ROLE`. Secrets live in `~/onsite.env` on the server, never in the repo. The frontend is Vercel, deployed by a push to `owl-frontend`.

Every container gets log rotation (`--log-opt max-size=10m --log-opt max-file=5`): Docker's default keeps logs forever and would eventually fill the disk.

### Deploy a backend release

```bash
# On the server, from ~/onsite. SHA is the commit being deployed.
git pull -q origin main && SHA=$(git rev-parse --short HEAD)
docker build -f apps/api/Dockerfile -t onsite-api:$SHA .

# Back up first (the direct, non-pooler Neon URL; pg_dump needs it).
docker run --rm --env-file ~/onsite.env postgres:18-alpine sh -c \
  'U=$(echo "$DATABASE_URL" | sed -E "s/\?.*//; s/-pooler//"); pg_dump "$U?sslmode=require" -Fc' > ~/backup-before-$SHA.dump

# Migrations, with the new image, before any container switches to it.
docker run --rm --env-file ~/onsite.env --network onsite-net onsite-api:$SHA npx prisma migrate deploy

# Swap the API and the worker (keep the old containers until the new ones are healthy).
for c in onsite-api onsite-worker; do docker stop $c && docker rename $c $c-old-$SHA && docker update --restart=no $c-old-$SHA; done
LOGS="--log-opt max-size=10m --log-opt max-file=5"
docker run -d --name onsite-api --network onsite-net --restart unless-stopped $LOGS -p 4000:4000 --env-file ~/onsite.env -e ROLE=api onsite-api:$SHA
docker run -d --name onsite-worker --network onsite-net --restart unless-stopped $LOGS --env-file ~/onsite.env -e ROLE=worker onsite-api:$SHA

curl -s http://localhost:4000/health/ready        # {"status":"ready",...}
docker ps --format '{{.Names}} {{.Status}}'       # both "healthy" within a minute or two
docker logs onsite-worker 2>&1 | grep -E 'worker process started|Reconciliation|rror' | head
```

Roll back by stopping the new containers and starting the `-old-$SHA` ones (`docker start`, `docker update --restart unless-stopped`). A migration is not rolled back that way; restore the backup if one must be undone.

**Build off this machine before real traffic.** On 2026-10-20 an image build on this 1 GB VM swapped so hard (compile 12.5 minutes, 1.5 GB of swap) that the live API stopped answering for a few seconds and SSH sessions dropped. Until the server is replaced (docs/22, #14), deploy when traffic is lowest; the better fix is to build the image in GitHub Actions, push it to a registry, and only pull it here.

### Settings that switch on once the accounts exist

Add to `~/onsite.env`, then recreate the API and worker containers (as in the deploy steps, same image):

- Email (docs/22, #6): `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=…`, `EMAIL_FROM=OnSite <no-reply@your-verified-domain>`.
- Error reporting (#16): `SENTRY_DSN=…`. Then add a Sentry alert rule for new issues, and an uptime check on `https://onsite-api.duckdns.org/health/ready`.
- Razorpay dashboard: the webhook must send `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`.

### Redis

Run with persistence so a restart does not lose queued matching, auto-approve and notification jobs or rate-limit state (docs/22, #15). Recreating the container loses what the old one held; do it between deploys, when queues are near empty.

```bash
docker run -d --name onsite-redis --network onsite-net --restart unless-stopped \
  --log-opt max-size=10m --log-opt max-file=5 -v onsite-redis-data:/data \
  redis:7-alpine redis-server --appendonly yes --appendfsync everysec --save 300 100 \
  --maxmemory 128mb --maxmemory-policy noeviction
```

`noeviction` is deliberate: queue data must never be silently evicted. The rate limiter and sign-in lock fail open if Redis refuses writes, so a full Redis slows nothing; watch for it in the logs.

### Release 2026-10-20 (P6 and the audit fixes)

Four migrations run with this deploy: `20261020090000_item_bill_approval`, `20261020120000_gateway_refunds`, `20261020150000_notification_outbox`, `20261020170000_storage_deletions`. In the Razorpay dashboard, add `refund.processed` and `refund.failed` to the webhook's events. After the deploy, within a couple of minutes, the worker log should show the 2 stranded expired tasks refunded ("refunded by the repair sweep") and a reconciliation line.

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
