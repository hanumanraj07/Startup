# 16 — Security Requirements

Rules, not aspirations. Each is checkable, and several are enforced by tests.

## Authentication

- Passwords hashed with **Argon2id**. Never stored, logged or returned in any form.
- Minimum 10 characters, checked against a common-password list. No composition rules that push people toward `Password1!`.
- Access tokens: JWT, 15 minutes. Refresh tokens: opaque, 30 days, stored hashed, delivered httpOnly, secure, sameSite.
- **Refresh rotation with reuse detection.** Presenting a retired token revokes the entire token family. This is the highest-value control in the authentication system.
- OTPs hashed at rest, 10-minute expiry, single use, five-attempt cap.
- Login failures return an identical message and take similar time whether or not the account exists.
- Password reset always responds identically, revealing nothing about account existence.
- Suspension invalidates outstanding tokens immediately via `token_version`, not at expiry.

## Authorization

- **Every protected endpoint checks authorization server-side.** A hidden button is not a permission.
- Two layers, both required: a guard for role and endpoint class, a service check for this caller against this resource in its current state.
- Return `404` instead of `403` where existence itself is sensitive.
- Verification level and account status are read from the database at the point of decision on any valuable action, never trusted from a token issued earlier.
- Admin actions are role-checked server-side on every request and always audited.

## Input

- **Every request body validated** against a Zod schema before reaching a service.
- Reject unknown fields rather than ignoring them, so a client cannot smuggle values into a create call.
- All database access is parameterized. **String interpolation into SQL is forbidden**, including inside the geo repository where raw SQL is otherwise permitted.
- Output encoded on render. React handles this; `dangerouslySetInnerHTML` requires written justification.
- Every user-supplied identifier validated as a UUID before use.

## The never-trust-the-client list

| Never accepted from a client | Always derived server-side |
|---|---|
| Payment success or state | Signature-verified webhook, or a server-initiated fetch |
| Task status | `transitions.ts`, evaluating preconditions |
| Any amount: budget, commission, payout | `packages/money`, computed from the task |
| Distance from the task location | PostGIS, from the reported coordinate |
| Whether proof requirements are met | Validated at submission |
| Verification level or eligibility | Read from the database |
| Which fields the caller may see | The projection for the caller's role |
| File type and size | Validated server-side, never from the declared content type alone |

## File uploads

- Presigned URLs are **short-lived**, scoped to a single object key, and constrained by content type and maximum size in the upload policy.
- The API validates the stored object after upload: actual content type, actual size, and that the key belongs to the expected task and worker.
- Uploaded media is served only through **short-lived presigned GET URLs**. There are no permanent public URLs for proof or KYC media.
- Image metadata is stripped on serving except the fields deliberately retained as evidence.
- KYC documents are stored under keys never exposed outside admin review.

## Payments

- **Webhook signatures verified before the payload is read.** An unverified webhook is discarded and logged.
- Webhook events deduplicated on a unique event identifier. Replay is a normal operating condition, not an attack.
- **Idempotency keys on every money-moving operation**, enforced by unique database constraints rather than application logic.
- Amounts never taken from a client.
- Payment state moves only forward; stale out-of-order events cannot reverse it.
- Nothing containing card data, full account numbers, or gateway secrets is ever logged.

## Data protection

- TLS everywhere. HSTS enabled.
- KYC document numbers and PAN **encrypted at rest**, decryptable only in the admin review path.
- Bank account numbers stored masked; full values live with the gateway, not here.
- Cross-party PII is blocked by explicit projections, and **asserted by tests over whole response bodies** so a column added later cannot leak quietly.
- Chat is redacted server-side for phone numbers, email addresses and UPI identifiers.
- Database backups encrypted. Restores tested, because an untested backup is a hope rather than a backup.

## Rate limiting

Applied per IP and per account, whichever binds first. Limits are listed in `docs/07-api-specification.md`.

Strictest on: login, registration, password reset, OTP send, payment creation. These are where credential stuffing, enumeration and cost-inflicting abuse concentrate.

Rate limit state lives in Redis so limits hold across API replicas rather than per-instance.

## Headers and transport

`Content-Security-Policy` (no inline scripts without nonces), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive `Permissions-Policy` allowing geolocation and camera only where required.

CORS allow-lists known origins. No wildcard with credentials, ever.

## Logging

**Logged:** authentication attempts and outcomes, authorization failures, all admin actions, every money movement, KYC decisions, suspensions and bans, configuration changes, webhook receipt and verification results.

**Never logged:** passwords, tokens, OTP codes, card data, full account numbers, KYC document numbers, session cookies, or full request bodies on authentication and payment endpoints.

Logs are structured JSON with a correlation identifier per request. Audit entries are append-only and are not deletable by admins.

## Dependencies and secrets

- All secrets from environment variables, validated at startup. **The process refuses to boot on missing configuration** rather than failing mysteriously later.
- No secret ever committed. `.env` is gitignored; `.env.example` carries names and comments only.
- Dependency vulnerability scanning in CI. A high-severity advisory blocks a merge.
- Lockfile committed, exact versions.

## Known accepted risks

Stated honestly rather than left implicit:

- **GPS can be spoofed.** It is treated as evidence weighed with photographs, timing and chat, never as proof on its own. Spoofing that survives that combination is possible and would surface as a dispute.
- **Manual KYC review can be deceived** by good forgeries. Automated verification is post-MVP.
- **Keyword screening for prohibited tasks will miss cleverly worded requests.** Manual review and reporting are the backstop.
- **Chat redaction can be evaded** by someone determined to share contact details. It raises friction; it does not eliminate the path.

## Before launch

- [ ] Dependency audit clean of high-severity findings
- [ ] Every endpoint confirmed to have authentication and authorization
- [ ] PII projection tests passing across all cross-party responses
- [ ] Rate limits verified under load
- [ ] Webhook signature verification tested, including a forged signature
- [ ] Idempotency verified by replaying every money operation
- [ ] Secrets confirmed absent from the repository history
- [ ] Backup restore performed successfully
- [ ] TLS and security headers verified in the deployed environment
- [ ] Admin access limited to known accounts with audit logging confirmed working
