// docs/20-scalability-performance.md:
// "Feed storm | 1,000 virtual users browsing the nearby feed against 10,000
// seeded Kolkata workers | p95 < 250ms, index scans only, no pool
// exhaustion."
//
// The "index scans only" half of this pass condition is what
// apps/api/src/repositories/geo.repository.explain.test.ts proves directly
// against the real seeded database (EXPLAIN ANALYZE, asserting
// worker_profiles_base_geog_gix and no Seq Scan) — that check does not need
// 1,000 virtual users, only a real query planner. This script proves the
// other half: that the query stays fast and the connection pool holds up
// under real concurrent load, which a single EXPLAIN ANALYZE cannot show.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { mintToken, authHeaders, BASE_URL } from './_lib.js';

const WORKER_IDS = JSON.parse(__ENV.WORKER_IDS || '[]');
if (WORKER_IDS.length === 0) throw new Error('Set WORKER_IDS to a JSON array of real seeded worker user ids.');

const tokens = WORKER_IDS.map((id) => mintToken(id));

export const options = {
  scenarios: {
    feed_storm: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 1000 },
        { duration: '2m', target: 1000 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<250'],
    http_req_failed: ['rate<0.01'],
  },
};

// Roughly Kolkata; jittered per call so VUs don't all query the identical point.
export default function () {
  const token = tokens[__VU % tokens.length];
  const lat = 22.5726 + (Math.random() - 0.5) * 0.1;
  const lng = 88.3639 + (Math.random() - 0.5) * 0.1;

  const res = http.get(
    `${BASE_URL}/api/v1/tasks/nearby?latitude=${lat}&longitude=${lng}&radiusMeters=10000&limit=20`,
    authHeaders(token),
  );

  check(res, { 'feed request succeeded': (r) => r.status === 200 });
  sleep(Math.random() * 2); // browsing, not hammering — matches docs/20's realistic activity profile
}
