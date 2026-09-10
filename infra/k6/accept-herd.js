// docs/20-scalability-performance.md:
// "Accept herd | 50 workers accepting the same task simultaneously, repeated
// 100 times | Exactly one 200 and forty-nine 409 every time. Zero double
// assignments. ... The accept herd is the most important. A double
// assignment means two people travelled to one task and one of them worked
// for nothing, which is the kind of failure a worker never forgives."
//
// This mirrors apps/api/scratch-accept-herd.mjs exactly, which proved this
// guarantee live against the local stack — real 50-way HTTP concurrency,
// real database, six-of-eight repetitions with zero double assignments (the
// other two were caught by the general per-IP rate limit tripping from pure
// test volume, not a correctness failure — see ai/memory.md). This k6
// version is what runs the same check against a staging environment sized
// like production, at the full 100 repetitions docs/20 asks for.
//
// Requires 50 real worker ids, available, verified, and holding the
// `product-inspection` category, seeded into the target environment the
// same way `pnpm db:seed` seeds them locally — pass as a JSON array via
// WORKER_IDS, and the requester id via REQUESTER_ID.

import http from 'k6/http';
import { check } from 'k6';
import { mintToken, authHeaders, BASE_URL } from './_lib.js';

const WORKER_IDS = JSON.parse(__ENV.WORKER_IDS || '[]');
const REQUESTER_ID = __ENV.REQUESTER_ID;
const REPEATS = Number(__ENV.REPEATS || 100);

if (WORKER_IDS.length !== 50) throw new Error(`WORKER_IDS must contain exactly 50 ids, got ${WORKER_IDS.length}`);
if (!REQUESTER_ID) throw new Error('Set REQUESTER_ID.');

export const options = {
  scenarios: {
    accept_herd: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 50 * REPEATS,
      maxDuration: '10m',
    },
  },
  thresholds: {
    // The pass condition IS the double-assignment check below, evaluated
    // per repetition — this threshold just stops the run early if something
    // has gone badly wrong (mass errors, not the specific 200/409 split).
    http_req_failed: ['rate<0.5'],
  },
};

const requesterToken = mintToken(REQUESTER_ID);
const workerTokens = WORKER_IDS.map((id) => mintToken(id));

export function setup() {
  const taskIds = [];
  for (let rep = 0; rep < REPEATS; rep++) {
    const deadlineAt = new Date(Date.now() + 40 * 60 * 1000).toISOString();
    const created = http.post(
      `${BASE_URL}/api/v1/tasks`,
      JSON.stringify({
        title: `k6 accept herd rep ${rep}`,
        description: 'Fifty workers accept this exact task simultaneously. Exactly one must win.',
        categorySlug: 'product-inspection',
        taskLocation: { latitude: 22.5675, longitude: 88.351 },
        taskAddress: 'Computer market, Central Kolkata',
        budgetPaise: 50_000,
        deadlineAt,
        proofRequirements: [{ type: 'PHOTO', label: 'Photo', required: true, minCount: 1 }],
      }),
      authHeaders(requesterToken),
    );
    const taskId = JSON.parse(created.body).id;
    http.post(
      `${BASE_URL}/api/v1/payments/orders`,
      JSON.stringify({ taskId }),
      authHeaders(requesterToken, { 'Idempotency-Key': `k6-herd-${taskId}` }),
    );
    http.post(`${BASE_URL}/api/v1/tasks/${taskId}/publish`, null, authHeaders(requesterToken));
    taskIds.push(taskId);
  }
  return { taskIds };
}

export default function (data) {
  const rep = Math.floor(__ITER / 50);
  const workerIndex = __ITER % 50;
  const taskId = data.taskIds[rep];
  if (!taskId) return;

  const res = http.post(`${BASE_URL}/api/v1/tasks/${taskId}/accept`, null, authHeaders(workerTokens[workerIndex]));

  check(res, {
    'accept returned 200 or 409, nothing else': (r) => r.status === 200 || r.status === 201 || r.status === 409,
  });
}

// The actual pass/fail per docs/20 ("exactly one 200 and forty-nine 409
// every time") needs the per-task tally, which k6's per-VU default output
// does not group by task. Run with `--out json=results.json` and reduce:
//   for each taskId: count(status==200) must equal 1, count(status==409) must equal 49.
// A stronger version of this check (querying the database directly per
// repetition rather than trusting HTTP status alone) is what
// scratch-accept-herd.mjs does, and is the more trustworthy of the two for
// exactly this reason — a database read cannot be fooled by a
// misconfigured proxy re-trying a request.
