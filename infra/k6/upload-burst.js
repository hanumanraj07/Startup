// docs/20-scalability-performance.md:
// "Upload burst | 100 concurrent presign requests and direct uploads | API
// p95 < 150ms and flat API memory, proving media genuinely bypasses the
// API."
//
// The presign call hits the API; the actual file upload (the PUT) goes
// straight to object storage — S3-compatible, MinIO locally — using the
// presigned URL, never touching the API process. That is the entire
// architectural claim under test: "The API never sees a byte of media"
// (docs/20, mistake #1). If API p95/memory stay flat while 100 real byte
// streams are in flight, the claim holds; if the API's own latency or
// memory moves with upload volume, media is going through it somehow and
// the architecture rule has been violated somewhere.

import http from 'k6/http';
import { check } from 'k6';
import { mintToken, authHeaders, BASE_URL } from './_lib.js';

const WORKER_ID = __ENV.WORKER_ID;
const TASK_ID = __ENV.TASK_ID; // a real task the worker above is assigned to and mid-execution on
if (!WORKER_ID || !TASK_ID) throw new Error('Set WORKER_ID and TASK_ID to a real assigned, in-progress task.');

const token = mintToken(WORKER_ID);

// A small, real JPEG-shaped payload — enough bytes to be a genuine upload,
// not so large that 100 concurrent VUs saturate a laptop's own network
// stack before the API is the thing being tested.
const FAKE_IMAGE_BYTES = new Uint8Array(200 * 1024).fill(0xff);

export const options = {
  scenarios: {
    upload_burst: {
      executor: 'shared-iterations',
      vus: 100,
      iterations: 100,
      maxDuration: '2m',
    },
  },
  thresholds: {
    // Only the presign call's latency is asserted against docs/20's p95;
    // the direct-to-storage PUT is expected to take however long a 200KB
    // upload takes on the network in use, which is not the API's concern.
    'http_req_duration{name:presign}': ['p(95)<150'],
  },
};

export default function () {
  const presign = http.post(
    `${BASE_URL}/api/v1/tasks/${TASK_ID}/proofs/presign`,
    JSON.stringify({ type: 'PHOTO', contentType: 'image/jpeg', sizeBytes: FAKE_IMAGE_BYTES.length }),
    { ...authHeaders(token), tags: { name: 'presign' } },
  );
  const presignOk = check(presign, { 'presign succeeded': (r) => r.status === 200 || r.status === 201 });
  if (!presignOk) return;

  const { uploadUrl, storageKey } = JSON.parse(presign.body);

  // Straight to object storage — no Authorization header, no API route at all.
  const uploaded = http.put(uploadUrl, FAKE_IMAGE_BYTES, {
    headers: { 'Content-Type': 'image/jpeg' },
    tags: { name: 'direct_upload' },
  });
  check(uploaded, { 'direct upload to storage succeeded': (r) => r.status === 200 });

  http.post(
    `${BASE_URL}/api/v1/tasks/${TASK_ID}/proofs`,
    JSON.stringify({ type: 'PHOTO', storageKey }),
    authHeaders(token),
  );
}
