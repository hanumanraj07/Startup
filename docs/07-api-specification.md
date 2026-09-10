# 07 — API Specification

REST over HTTPS. JSON. Base path `/api/v1`.

## Conventions

- Authentication is a bearer access token. Refresh tokens travel in an httpOnly, secure, sameSite cookie and are never readable by JavaScript.
- Every request body is validated against a Zod schema from `packages/validation`, shared with the web app so client and server cannot disagree about what is valid.
- Every response is an explicit projection. A Prisma entity is never serialized directly.
- Errors are uniform:

```json
{ "error": { "code": "TASK_ALREADY_ASSIGNED",
             "message": "Another worker accepted this task first.",
             "details": {} } }
```

- Lists are cursor-paginated: `?limit=20&cursor=<opaque>`, returning `{ "data": [...], "nextCursor": "..." }`. No endpoint returns an unbounded collection.
- Money in requests and responses is always integer paise, in fields ending `Paise`.
- Money-moving requests require an `Idempotency-Key` header.

| Status | Meaning |
|---|---|
| 400 | Malformed request |
| 401 | Missing or invalid token |
| 403 | Authenticated but not permitted for this resource |
| 404 | Not found, or not visible to this caller |
| 409 | Conflict, such as a task already assigned |
| 422 | Valid shape, but violates a business rule |
| 429 | Rate limited |

`404` rather than `403` is returned when revealing existence would itself leak information.

## Auth

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | Email, password, display name. Strict rate limit |
| POST | `/auth/login` | public | Strict rate limit, generic failure message |
| POST | `/auth/google` | public | ID token exchange |
| POST | `/auth/refresh` | cookie | Rotates. **Reuse of a retired token revokes the whole family** |
| POST | `/auth/logout` | user | Revokes the family |
| POST | `/auth/verify-email` | public | Token from email |
| POST | `/auth/phone/send-otp` | user | Rate limited per user and per phone |
| POST | `/auth/phone/verify-otp` | user | Attempt-capped. Raises verification level to 1 |
| POST | `/auth/password/forgot` | public | Always responds identically, whether or not the account exists |
| POST | `/auth/password/reset` | public | |

## Users

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/users/me` | user | Full private self view |
| PATCH | `/users/me` | user | Display name, avatar, city, home location |
| GET | `/users/:id/public` | user | **Public projection only.** No phone, email, address, coordinates, KYC or bank data |
| POST | `/users/me/kyc` | user | Submit documents. Returns pending |
| GET | `/users/me/kyc` | user | Own status and rejection reason |
| POST | `/users/me/payout-accounts` | user | Bank or UPI plus PAN |
| GET | `/users/me/payout-accounts` | user | Masked identifiers only |

## Worker profile

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/workers/me` | user | Create the work profile |
| GET | `/workers/me` | worker | |
| PATCH | `/workers/me` | worker | Base location, radius, categories |
| PATCH | `/workers/me/availability` | worker | Toggle availability |
| GET | `/workers/me/stats` | worker | Earnings, completion rate, response rate |

## Tasks

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/tasks` | user | Creates a **draft**. Server computes commission and payout. Client-supplied fee values are ignored. Prohibited screening and risk scoring run here |
| GET | `/tasks/mine` | requester | Own tasks |
| GET | `/tasks/:id` | party | Projection differs by role. See below |
| PATCH | `/tasks/:id` | requester | Draft only |
| POST | `/tasks/:id/publish` | requester | **Requires captured payment.** Fails otherwise |
| POST | `/tasks/:id/cancel` | requester | Refund per policy |
| GET | `/tasks/:id/history` | party | Status transition history |

**Role-dependent projection of `GET /tasks/:id`:**

| Field | Requester | Assigned worker | Other worker |
|---|---|---|---|
| Title, description, category, deadline | yes | yes | yes |
| Task location, exact | yes | yes | approximate only |
| Budget and payout | yes | payout only | payout only |
| Requester identity | own | display name, rating, level | display name, rating |
| Requester email, phone, home address, `requester_geog` | never in any response | never | never |
| Worker identity | display name, rating, level, history | own | not present |
| Worker phone, email, address, KYC, bank | never | own | never |

Unassigned tasks show an approximate location to workers, not the exact address. Exact coordinates are revealed on assignment.

## Discovery and matching

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/tasks/nearby` | worker | The feed. PostGIS radius search, ranked. Requires availability. Paginated |
| POST | `/tasks/:id/accept` | worker | **Atomic.** Exactly one winner; the rest get `409 TASK_ALREADY_ASSIGNED`. Verification level enforced here |
| POST | `/tasks/:id/decline` | worker | Records a decline and reason |

## Execution

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/tasks/:id/en-route` | assigned worker | |
| POST | `/tasks/:id/arrive` | assigned worker | **Server measures the reported coordinate against the task location with PostGIS** and records the distance and geofence result. The client never supplies a distance |
| POST | `/tasks/:id/proofs/presign` | assigned worker | Returns a short-lived presigned PUT. Content type and size limits are enforced in the policy |
| POST | `/tasks/:id/proofs` | assigned worker | Records metadata after upload. Server computes distance and sets verification flags |
| GET | `/tasks/:id/proofs` | party | Presigned GET URLs, short-lived. Never permanent public links |
| DELETE | `/tasks/:id/proofs/:proofId` | assigned worker | Before submission only |
| POST | `/tasks/:id/submit` | assigned worker | **Validates every required proof is present.** Sets `review_deadline_at = now() + 24h` |
| POST | `/tasks/:id/blocker` | assigned worker | Report an inability to complete, with evidence |

## Review

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/tasks/:id/approve` | requester | Releases payment, queues payout |
| POST | `/tasks/:id/reject` | requester | Requires a reason. Returns to in progress for rework |
| POST | `/tasks/:id/review` | party | Rating 1 to 5, after completion only |

## Payments

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/payments/orders` | requester | Creates a gateway order for a draft task. **Amount computed server-side from the task**, never taken from the client. Idempotency key required |
| GET | `/payments/:id` | requester | Server-side truth, not a client claim |
| POST | `/payments/webhook` | **public, signature-verified** | Razorpay callback. Signature verified before anything else. Deduplicated on event id. Replay-safe |
| GET | `/payouts/mine` | worker | Payout history |
| GET | `/payments/mine` | requester | Payment history |

**The webhook is the only thing that moves payment state forward.** A browser returning from a gateway redirect triggers a refresh, never a state change.

## Chat

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/tasks/:id/messages` | party | Paginated |
| POST | `/tasks/:id/messages` | party | **Server redacts phone numbers, email addresses and UPI identifiers** and records flags |
| POST | `/tasks/:id/messages/read` | party | |

WebSocket namespace `/ws`, room per task, membership authorized on connection. Socket.IO with the Redis adapter so any API instance can serve any socket.

## Notifications

| Method | Path | Auth |
|---|---|---|
| GET | `/notifications` | user |
| POST | `/notifications/read` | user |
| POST | `/notifications/push/subscribe` | user |
| DELETE | `/notifications/push/subscribe` | user |
| GET/PATCH | `/notifications/preferences` | user |

## Disputes

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/tasks/:id/dispute` | party | **Freezes payment immediately.** Only within the review window |
| GET | `/disputes/mine` | user | |
| GET | `/disputes/:id` | party | |
| POST | `/disputes/:id/statement` | party | Own account, with attachments |

## Reference and safety

| Method | Path | Auth |
|---|---|---|
| GET | `/categories` | public |
| GET | `/cities` | public |
| GET | `/tasks/price-hint` | user |
| POST | `/reports` | user |
| POST | `/users/:id/block` | user |

## Admin

All require `platform_role = ADMIN`. All write actions produce an audit log entry.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/kyc` | Review queue |
| POST | `/admin/kyc/:id/decision` | Approve, reject with reason, or request resubmission |
| GET | `/admin/disputes` | Queue |
| GET | `/admin/disputes/:id/evidence` | The full assembled bundle |
| POST | `/admin/disputes/:id/resolve` | Release, refund, or split. Reasoning required |
| GET | `/admin/users` | Search |
| POST | `/admin/users/:id/suspend` | Reason required |
| GET | `/admin/tasks` | Oversight, including risk-flagged tasks |
| POST | `/admin/tasks/:id/block` | Prohibited content |
| GET | `/admin/payments` | Oversight |
| POST | `/admin/payouts/:id/retry` | Manual intervention, audited |
| GET | `/admin/metrics` | Completion rate, time to match, dispute rate, GMV, active workers by city |

## Operational

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness. No dependency checks |
| GET | `/health/ready` | Readiness: database, Redis, storage |

## Rate limits

| Class | Limit |
|---|---|
| Login, register, password reset | 5 per 15 minutes per IP and per account |
| OTP send | 3 per hour per user and per phone |
| Payment creation | 10 per hour per user |
| Task creation | 20 per hour per user |
| Accept | 30 per minute per worker |
| Messages | 60 per minute per user |
| Presign | 60 per hour per task |
| General authenticated reads | 300 per minute per user |

## Server-side enforcement, non-negotiable

Restating what must never be taken from a client:

| Never trusted | Always server-derived |
|---|---|
| Payment success | Signature-verified webhook or a server-initiated fetch |
| Task status | `transitions.ts` evaluating preconditions |
| Commission, payout, any amount | Computed from the task in `packages/money` |
| Distance from the task location | PostGIS, from the reported coordinate |
| Whether proof requirements are met | Validated at submission against the task's requirements |
| Verification level and eligibility | Read from the database at acceptance |
| Who may see a field | The projection for the caller's role |
