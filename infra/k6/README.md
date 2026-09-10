# k6 load tests

The four scenarios from `docs/20-scalability-performance.md`. **Not run in this environment** — k6 is not installed here, and the doc itself says to run these "against a staging environment sized like production, not against a laptop." These scripts are real and ready, not placeholders.

The scenario that matters most — the accept herd — was proven separately and directly against the real local stack, without k6, because it is the single guarantee worth checking by hand rather than trusting a tool's output: see `ai/memory.md`'s entry on the rate-limiting fix that same run surfaced.

## Running these for real

```bash
# Install k6: https://k6.io/docs/get-started/installation/
export BASE_URL=https://staging.onsite.example.com
export JWT_ACCESS_SECRET=<the staging environment's real secret>

k6 run feed-storm.js
k6 run accept-herd.js
k6 run lifecycle-soak.js
k6 run upload-burst.js
```

Every script mints its own JWTs directly (see each file's comment) rather than logging in through `/auth/login` for each virtual user — the login rate limit exists to protect the credential-checking path from real abuse, not to cap how many pre-authenticated requests a load-test harness may issue, and routing thousands of VUs through it would trip limits that have nothing to do with what is actually under test. This mirrors exactly how `apps/api/scratch-accept-herd.mjs` proved the accept-herd guarantee live in this session.

**Never run these against production data.** Point `BASE_URL` at a staging environment seeded the same way `pnpm db:seed` seeds local development — 10,000+ workers, so the geo queries are exercised at a realistic scale, not the "thirty rows proves nothing" trap docs/20 calls out.
