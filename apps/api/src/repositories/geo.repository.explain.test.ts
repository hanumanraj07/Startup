import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * docs/20-scalability-performance.md: "`ST_DWithin` over a growing worker
 * table without a GIST index degrades from milliseconds to seconds as
 * supply grows... Verified by EXPLAIN ANALYZE in tests asserting index
 * scans rather than sequential scans, against 10,000 seeded workers.
 * Testing a geo index against thirty rows proves nothing."
 *
 * This is a genuine integration test against the real, seeded development
 * database (run `pnpm db:seed` first) — the guarantee it checks (does the
 * query planner choose an index) cannot be proven any other way; a
 * fake-Prisma unit test would only prove the SQL string looks right, never
 * that Postgres actually uses the index it was built for. Every other test
 * in this codebase is a pure function or a fake-Prisma unit test
 * specifically to avoid a database dependency — this file is the deliberate
 * exception, for the one property that has no other way to be checked.
 *
 * Uses `$queryRaw`'s tagged template, never `$queryRawUnsafe`, for the same
 * reason geo.repository.ts itself does — docs/16-security-requirements.md:
 * "String interpolation into SQL is forbidden, including inside the geo
 * repository where raw SQL is otherwise permitted." The coordinates here
 * are hardcoded test constants, not user input, but the rule is about the
 * mechanism, not this call site's particular risk.
 *
 * Requires `docker compose up -d` and a seeded database, exactly like the
 * rest of local development already does (see CLAUDE.md's Commands table).
 */
const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GeoRepository query plans, against the real seeded database', () => {
  it('findNearbyWorkers-shaped query uses the GIST index, not a sequential scan', async () => {
    const workerCount = await prisma.workerProfile.count();
    // A guard, not an assertion about this test itself: if the seed hasn't
    // been run, everything below is meaningless — "testing a geo index
    // against thirty rows proves nothing" applies exactly as much to this
    // suite as to the codebase it is checking.
    expect(workerCount).toBeGreaterThan(5_000);

    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(88.351, 22.5675), 4326)::geography`;
    const rows = await prisma.$queryRaw<{ 'QUERY PLAN': string }[]>`
      EXPLAIN ANALYZE
      SELECT u.id, ST_Distance(wp.base_geog, ${point}) AS d
      FROM worker_profiles wp
      JOIN users u ON u.id = wp.user_id
      WHERE wp.is_available = true
        AND ST_DWithin(wp.base_geog, ${point}, 3000)
      ORDER BY d ASC
      LIMIT 25
    `;
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');

    expect(plan).toContain('worker_profiles_base_geog_gix');
    expect(plan).not.toMatch(/Seq Scan on worker_profiles/);
  });

  it('findNearbyTasks-shaped query uses the GIST index over open tasks, not a sequential scan', async () => {
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(88.351, 22.5675), 4326)::geography`;
    const rows = await prisma.$queryRaw<{ 'QUERY PLAN': string }[]>`
      EXPLAIN ANALYZE
      SELECT t.id, ST_Distance(t.task_geog, ${point}) AS d
      FROM tasks t
      WHERE t.status IN ('PUBLISHED','MATCHING')
        AND t.assigned_worker_id IS NULL
        AND t.deadline_at > now()
        AND ST_DWithin(t.task_geog, ${point}, 10000)
      ORDER BY d ASC
      LIMIT 20
    `;
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');

    expect(plan).not.toMatch(/Seq Scan on tasks/);
  });
});
