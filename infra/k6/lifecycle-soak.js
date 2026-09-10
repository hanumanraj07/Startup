// docs/20-scalability-performance.md:
// "Lifecycle soak | Full task lifecycles sustained for 30 minutes | Flat
// memory, connections stable, ledger balances to zero for every task."
//
// Each iteration drives one task through create -> fund -> publish -> accept
// -> en-route -> arrive -> submit -> approve, at a steady rate, for the full
// window. "Flat memory" and "connections stable" are read off the API
// process's own metrics/APM during the run, not from k6's own output — k6
// only proves the request volume was sustained. The ledger check is the one
// piece of ground truth this script can assert on its own: after the run,
// query `unbalanced_tasks` (see geo.repository.ts's findUnbalancedTasks) and
// require zero rows, exactly as every phase of this project's own manual
// testing has done throughout.
//
// Deliberately does not attempt proof upload against real object storage —
// that path is what upload-burst.js exercises instead. Each task here
// submits with a NOTE-type proof (recordProof's storageKey is optional for
// that type), keeping this scenario focused purely on the status-transition
// and money-movement path over a long, steady soak.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { mintToken, authHeaders, BASE_URL } from './_lib.js';

const REQUESTER_ID = __ENV.REQUESTER_ID;
const WORKER_IDS = JSON.parse(__ENV.WORKER_IDS || '[]');
if (!REQUESTER_ID) throw new Error('Set REQUESTER_ID.');
if (WORKER_IDS.length === 0) throw new Error('Set WORKER_IDS to a JSON array of real seeded worker user ids.');

const requesterToken = mintToken(REQUESTER_ID);
const workerTokens = WORKER_IDS.map((id) => mintToken(id));

export const options = {
  scenarios: {
    lifecycle_soak: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
  },
};

export default function () {
  const workerToken = workerTokens[__VU % workerTokens.length];
  const deadlineAt = new Date(Date.now() + 40 * 60 * 1000).toISOString();

  const created = http.post(
    `${BASE_URL}/api/v1/tasks`,
    JSON.stringify({
      title: `k6 lifecycle soak ${__VU}-${__ITER}`,
      description: 'A full lifecycle, sustained, checked for a balanced ledger afterward.',
      categorySlug: 'product-inspection',
      taskLocation: { latitude: 22.5675, longitude: 88.351 },
      taskAddress: 'Computer market, Central Kolkata',
      budgetPaise: 50_000,
      deadlineAt,
      proofRequirements: [{ type: 'NOTE', label: 'Confirmation note', required: true }],
    }),
    authHeaders(requesterToken),
  );
  if (created.status !== 201) return;
  const taskId = JSON.parse(created.body).id;

  http.post(
    `${BASE_URL}/api/v1/payments/orders`,
    JSON.stringify({ taskId }),
    authHeaders(requesterToken, { 'Idempotency-Key': `k6-soak-${taskId}` }),
  );
  http.post(`${BASE_URL}/api/v1/tasks/${taskId}/publish`, null, authHeaders(requesterToken));

  const accepted = http.post(`${BASE_URL}/api/v1/tasks/${taskId}/accept`, null, authHeaders(workerToken));
  if (accepted.status !== 200 && accepted.status !== 201) return; // lost the race to another VU's worker — expected under load, not a failure

  http.post(`${BASE_URL}/api/v1/tasks/${taskId}/en-route`, null, authHeaders(workerToken));
  http.post(
    `${BASE_URL}/api/v1/tasks/${taskId}/arrive`,
    JSON.stringify({ location: { latitude: 22.5675, longitude: 88.351 } }),
    authHeaders(workerToken),
  );
  http.post(
    `${BASE_URL}/api/v1/tasks/${taskId}/proofs`,
    JSON.stringify({ type: 'NOTE', noteBody: 'Confirmed in stock and sealed.' }),
    authHeaders(workerToken),
  );
  const submitted = http.post(
    `${BASE_URL}/api/v1/tasks/${taskId}/submit`,
    JSON.stringify({}),
    authHeaders(workerToken),
  );
  check(submitted, { 'submitted successfully': (r) => r.status === 200 || r.status === 201 });

  const approved = http.post(`${BASE_URL}/api/v1/tasks/${taskId}/approve`, null, authHeaders(requesterToken));
  check(approved, { 'approved successfully': (r) => r.status === 200 || r.status === 201 });

  sleep(1);
}

// After the run: connect to the target database and confirm
//   SELECT count(*) FROM unbalanced_tasks;
// returns 0. Any nonzero result is docs/20's own monitoring rule made
// concrete: "Ledger imbalance | Any. Treated as an incident, not a warning."
