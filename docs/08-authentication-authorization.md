# 08 — Authentication and Authorization

## Authentication

**Passwords** are hashed with Argon2id. Never stored, logged, or returned in any form.

**Access tokens** are short-lived JWTs, 15 minutes, carrying `sub`, `platform_role`, `verification_level` and `token_version`. Sent as `Authorization: Bearer`.

**Refresh tokens** are opaque, 30 days, stored hashed, delivered in an httpOnly, secure, sameSite cookie. JavaScript never reads them.

**Rotation with reuse detection.** Every refresh issues a new token and retires the old one. Refresh tokens carry a `family_id`. If a retired token is presented again, that is a stolen-token signal and **the entire family is revoked**, forcing re-authentication. This is the single highest-value authentication control here and it is not optional.

**OTP** codes are six digits, hashed at rest, valid for 10 minutes, single use, capped at five attempts, and rate limited per user and per phone number. In development they are printed to the console so the whole flow works without an SMS provider.

**Google sign-in** verifies the ID token server-side against Google's keys. An unverified email from an identity provider is not treated as verified.

## Roles

| Role | Who |
|---|---|
| `USER` | Every account. Acts as requester, executor, or both |
| `ADMIN` | Platform staff |

Requester and executor are **modes, not roles**. The same account does both. What gates worker actions is having a worker profile and a sufficient verification level, not a separate role. This keeps the permission model simple and matches how people actually use the product.

Relationship to a specific task determines most permissions:

| Relationship | Meaning |
|---|---|
| Owner | `task.requester_id = caller` |
| Assignee | `task.assigned_worker_id = caller` |
| Party | Owner or assignee |
| Candidate | A worker eligible to see a task in their feed |

## Verification levels

| Level | Requires | Unlocks |
|---|---|---|
| 0 | Registered | Browse. Cannot post or accept |
| 1 | Email and phone verified | Post tasks. Accept tasks up to ₹1,000 |
| 2 | Government ID and selfie, admin approved | Accept tasks ₹1,000 to ₹5,000 |
| 3 | Address verified | Accept tasks above ₹5,000 |
| 4 | Sustained record: 50+ completions, ≥4.5 rating, ≥95% completion | Priority ranking, higher-value tasks |
| 5 | Professional tier | Reserved for business work |

**Enforced server-side at acceptance**, by reading the database. A stale level in a JWT is never sufficient authority to accept a high-value task.

## Permission matrix

### Requester

Can, on their own tasks only:

- Create, edit while draft, publish once funded, cancel
- View full details, chat with the assigned worker
- Approve, reject with a reason, raise a dispute, rate the worker
- View their own payment history

Cannot:

- View or modify another user's task
- See the worker's phone, email, home address, KYC documents or bank details
- Change budget, commission or payout after publication
- Release payment directly. Approval triggers release; it does not perform it
- Contact the worker outside in-app chat
- Publish a task without captured funds

### Executor

Can:

- Set base location, radius, categories, availability
- Browse nearby tasks within eligibility
- Accept an unassigned task at or below their verification level
- On assigned tasks: mark en route, confirm arrival, upload proof, submit, chat, report a blocker
- Raise a dispute, rate the requester, view own earnings

Cannot:

- Change any task field, above all budget or payout
- See the requester's phone, email, home address or home coordinates
- See exact task coordinates for tasks not assigned to them
- Accept a task above their verification level
- Accept an already-assigned task
- Submit without every required proof present
- Release their own payment
- View another worker's tasks, offers or earnings

### Administrator

Can:

- Review and decide KYC
- View dispute evidence and resolve disputes
- Search users, suspend and ban with a recorded reason
- View and moderate tasks, block prohibited content
- View payments and payouts, retry a failed payout
- Configure categories and pricing hints
- View operational metrics

Cannot, and this matters:

- Silently modify a task's content or a proof record
- Move money outside the dispute resolution and retry paths
- Read chat except within a dispute evidence bundle
- Act without producing an audit log entry
- Decrypt stored KYC document numbers outside the review interface

## How authorization is checked

Two independent layers, both required:

1. **Guard.** Is the caller authenticated and does their role permit this endpoint class at all?
2. **Service.** May this specific caller act on **this specific resource** in its **current state**?

Only the second stops a requester reading someone else's task, or a worker submitting proof for a task assigned to another worker. A guard alone is not access control.

Every service-level check answers three questions: relationship to the resource, verification level sufficiency, and whether the resource's current state permits the action.

## Rules that are easy to get wrong

- **Never rely on the client hiding something.** A hidden button is not a permission.
- **Never trust claims in a JWT for authorization on valuable actions.** Verification level and account status are read from the database at the point of decision, because a token issued this morning may describe an account suspended this afternoon.
- **Return `404` where `403` would leak existence.** A worker probing task identifiers must not learn which ones exist.
- **Suspension takes effect immediately**, not at token expiry. Account status is checked on every authenticated request, and `token_version` is bumped on suspension to invalidate outstanding tokens.
- **Authorization is per resource, not per collection.** Filtering a list correctly does not excuse skipping the check on the item endpoint.
