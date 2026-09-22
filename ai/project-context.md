# OnSite — Project Context

Read this file before touching any code in this repository.

## What OnSite is

OnSite is a two-sided marketplace for **remote physical tasks** in India.

Someone who cannot be at a place pays a verified person who is already there to do a physical task and prove it was done.

The canonical example, which the entire product is designed around:

> A requester in Ahmedabad wants to buy a MacBook Air M4 16/512 from a specific shop in Kolkata. They post a task: visit XYZ Computer Store, confirm the model is in stock, verify the serial number, photograph the sealed box, record a short video, ask the final price, and do not purchase anything. Budget ₹500, deadline 6:00 PM today.
>
> A worker living 3 km from that shop sees the task, accepts it, visits the store, and uploads photos, a video, the price and the serial number with GPS coordinates and timestamps attached. They submit.
>
> The requester reviews the evidence and approves. ₹425 is released to the worker. OnSite keeps ₹75.

Every line of code in this repository exists to make that flow reliable, safe and trustworthy at scale.

## The users

**Requester** — needs something done at a location they cannot reach. Creates and funds tasks, reviews evidence, approves or disputes.

**Executor (worker)** — is already near the task location and wants to earn. Discovers nearby tasks, accepts, executes, submits proof, gets paid.

**Administrator** — reviews KYC, resolves disputes, monitors operations.

One account can be both requester and executor. Role is a mode the user switches into, not a separate signup.

## The one thing that makes this product different

**A task has two locations, and they are not the same location.**

- The **requester location** is where the person posting the task is. Ahmedabad.
- The **task location** is where the physical work happens. Kolkata.

Matching runs from **task location → worker location**. The requester's location is almost never used for matching. Any query, feature or ranking that matches workers against the requester's location is a defect, not a design choice.

## Invariants

These are not preferences. Breaking any one of them is a defect.

1. **Matching uses task location and worker location.** Never requester location.
2. **The server decides task state.** Clients request transitions. They never assert them. All status writes go through one module.
3. **The server decides payment state.** A client claiming "payment succeeded" means nothing. Only a signature-verified gateway webhook or a server-initiated fetch changes payment state.
4. **Client GPS is evidence, not fact.** Every submitted coordinate is measured against the task location server-side and flagged when it does not match. The client never computes its own distance and is never believed about it.
5. **Money never moves on trust.** Requester funds are captured before a task becomes visible to workers, held, and released only on approval, auto-approval, or an admin dispute decision.
6. **Personal data never crosses the marketplace.** A worker never learns the requester's home address, phone or email. A requester never learns the worker's home address, phone or email. They share the task location and in-app chat. Nothing else.
7. **Every rupee is double-entry.** All money movement is recorded as balanced ledger rows. The sum of ledger entries for any task must be exactly zero.
8. **The launch scope is narrow on purpose.** Remote inspection and verification, one launch category set, any task location within India — but worker recruitment and verified supply remain concentrated in Ahmedabad and Kolkata, so coverage outside them is thin by fact, not by a code gate. This platform is not "any task category, anywhere in the world," and proposals to widen the category list or go outside India belong in `docs/18-future-roadmap.md`, not in code. See `ai/memory.md`, 2026-09-22, for why the geographic gate specifically was lifted.

## Non-negotiable code locations

Three concerns are centralized. If you find yourself writing these anywhere else, stop.

| Concern | The only place it lives |
|---|---|
| Task status writes | `apps/api/src/modules/tasks/transitions.ts` |
| Raw PostGIS SQL | `apps/api/src/repositories/geo.repository.ts` |
| Money movement | `apps/api/src/modules/payments/ledger.service.ts` |

## Where the truth lives

Do not infer product rules from code. Read the spec.

| Question | File |
|---|---|
| What are we building and for whom | `docs/01-product-requirements.md` |
| How does OnSite make money | `docs/02-business-model.md` |
| What does each user journey look like | `docs/03-user-flows.md` |
| Is this feature in scope | `docs/04-feature-specification.md` and `docs/17-mvp-scope.md` |
| What is the architecture | `docs/05-system-architecture.md` |
| What tables and columns exist | `docs/06-database-design.md` |
| What endpoints exist | `docs/07-api-specification.md` |
| Who is allowed to do what | `docs/08-authentication-authorization.md` |
| What states can a task be in | `docs/09-task-lifecycle.md` |
| How are workers matched and ranked | `docs/10-matching-engine.md` |
| How does money move | `docs/11-payment-flow.md` |
| How is trust established and abuse prevented | `docs/12-trust-safety.md` |
| What triggers a notification | `docs/13-notification-system.md` |
| What happens when it goes wrong | `docs/14-dispute-resolution.md` |
| What can an admin do | `docs/15-admin-panel.md` |
| What are the security rules | `docs/16-security-requirements.md` |
| What comes later | `docs/18-future-roadmap.md` |
| How should the UI look and feel | `docs/19-ui-design-system.md` |
| How does this hold 1,000+ users | `docs/20-scalability-performance.md` |
| What was decided and why | `ai/memory.md` |

The original founder document, `prompt.md`, is the source these specs were derived from. It is history and rationale, not a live spec. When it disagrees with `docs/`, `docs/` wins.
