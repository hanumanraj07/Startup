# 18 — Future Roadmap

Everything here is **out of current scope**. This file exists so good ideas can be recorded without contaminating the MVP.

Nothing moves from this file into development without an explicit decision and a move into `docs/17-mvp-scope.md`.

## Phase 1 — Prove the loop *(current)*

Remote inspection and verification. Ahmedabad and Kolkata. The six launch categories.

**Exit criteria, all of them, before Phase 2 begins:**

| Metric | Threshold |
|---|---|
| Completion rate | ≥ 90% |
| Median time to match | ≤ 30 minutes |
| Dispute rate | ≤ 5% |
| Repeat requester rate | ≥ 30% within 60 days |
| Completed tasks | 200+ |
| Active verified workers | 50+ across both cities |

Growing before these hold multiplies a broken model.

## Phase 2 — Deepen and expand carefully

**More categories, one at a time.** Pickup and delivery, document submission, queue standing, appointment attendance. Each is added only after its fraud and safety modes are understood. Every new category needs its own proof requirements and risk rules.

**More cities, in pairs.** Delhi and Mumbai next, since traffic to and from them is highest. Supply is recruited before demand is opened, never the reverse.

**Product depth:** written reviews, saved locations, task templates and reposting, worker earnings statements, address verification for level 3, automated KYC via DigiLocker, Hindi and Bengali, SMS once DLT registration completes, wallet and instant payout at a fee.

## Phase 3 — Quality and margin

**Better matching:** decline reasons feeding ranking, worker schedule awareness, predicted acceptance, and pricing suggestions modelled on actual completion data rather than guesses.

**Trust:** verification levels 4 and 5, a professional worker tier, fraud pattern detection, automated dispute triage with human confirmation.

**Revenue:** priority matching, the verified professional tier at a premium, and structured inspection reports rather than raw evidence.

## Phase 4 — Business customers

The economics change here. A company compares OnSite against ₹8,000 of employee travel rather than against asking a friend.

Business accounts with multiple users and shared billing. Bulk task creation. Named worker pools. Structured branded reports. Invoicing with GST compliance. Service-level commitments. Recurring inspection schedules.

Target buyers: e-commerce sellers verifying inventory, companies verifying suppliers, lenders verifying collateral, real estate needing property condition reports, retail chains auditing signage and shelf presence.

**Why not sooner.** A business will not commission supplier verification from a marketplace whose completion rate is unproven. Consumer tasks build the worker base and the reliability record that make this pitch credible.

## Phase 5 — The API

The largest long-term opportunity, and the one that changes what the company is.

```json
POST /v1/tasks
{
  "type": "supplier_verification",
  "location": { "address": "...", "city": "Kolkata" },
  "deadline": "2027-03-14T18:00:00Z",
  "requirements": ["photos", "video", "inventory_check"],
  "budget_paise": 150000
}
```

A system submits a physical-world task and receives completed work with evidence. Webhooks for status, structured evidence responses, sandbox environment, usage-based pricing.

At that point OnSite is not an app where people post tasks. It is **an API for the physical world**, and the distributed human network is the infrastructure behind it.

## Phase 6 — Network

Native mobile apps once iOS share or background location justifies them. National coverage. Machine-learned matching, once there is enough completion history to learn from honestly. Instant matching in dense areas. Insurance-backed high-value tasks. A worker community and progression system.

## Ideas parked deliberately

Recorded with the reason they are parked, so they are not revisited from scratch.

| Idea | Why parked |
|---|---|
| Purchasing on behalf of requesters | Changes the liability and trust model entirely. Would need insurance, much higher verification, and a different payment structure |
| Package transport between cities | Regulated logistics, and a different business |
| Worker employment rather than marketplace | Contradicts the model, and Indian labour classification makes it costly |
| Crypto payments | Adds regulatory risk and solves nothing for this user base |
| Social features and worker-to-worker networking | Marketplace leakage risk outweighs the engagement gain |
| Consumer subscriptions | Task frequency is too low for a subscription to make sense |
| Gamified worker levels beyond verification | Risks incentivising volume over quality, and completion quality is the product |

## The long-term picture

```
                    OnSite
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
      People     Businesses       APIs
         │            │            │
         └────────────┼────────────┘
                      ▼
               Physical world
                      │
      ┌───────────────┼───────────────┐
      ▼               ▼               ▼
  Inspection     Verification      Collection
```

The flywheel that makes it work: more workers means more coverage, which means faster matching, which means more requesters, which means more tasks, which means more worker income, which means more workers.

**The flywheel only turns after Phase 1 exit criteria are met.** Everything above is contingent on the boring, difficult work of making 200 tasks complete reliably in two cities.
