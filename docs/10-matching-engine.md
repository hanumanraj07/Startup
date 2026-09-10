# 10 — Matching Engine

The most product-specific part of the platform. Matching decides whether a task gets done quickly, and time to match is a launch metric.

## Principle

**Nearest does not win. Best match wins.**

A worker 2 km away rated 4.9 with 87 similar tasks completed is a better outcome for everyone than a worker 1 km away rated 3.8 with two completions and a 72% completion rate. Proximity is one input, not the answer.

## Pipeline

```
Task published
   ↓
Filter    — who is eligible at all
   ↓
Score     — rank the eligible
   ↓
Offer     — notify the top N in the current radius tier
   ↓
Wait      — tier timeout
   ↓
Expand    — widen the radius, offer to the next group
   ↓
Expire    — deadline reached with no acceptance → refund
```

Matching runs in the background worker process. **Publishing a task returns as soon as the task is persisted.** Fan-out never happens inside the request.

## Filters

Applied in SQL. A worker must satisfy every one:

| Filter | Rule |
|---|---|
| Availability | `is_available = true` |
| Account | `status = 'ACTIVE'`, not suspended or banned |
| Verification | `verification_level >= task.min_verification_level` |
| Distance | Within the task's current radius tier |
| **Worker's own radius** | Within `working_radius_m`. A worker who will not travel 12 km is not offered a task 12 km away |
| Category | The task's category is in their selected categories |
| Not the requester | A requester cannot be matched to their own task |
| Not blocked | Neither party has blocked the other |
| Not already offered | No existing offer for this task and worker |
| Not overloaded | Below the concurrent active task cap, default 3 |

The last filter matters more than it looks. A worker holding five simultaneous tasks completes few of them well, and completion rate is the metric the whole product rests on.

## Score

Weighted sum, normalized to 0–100. Deliberately a transparent formula rather than a model: it can be explained to a worker who asks why they are ranked low, and debugged when it misbehaves. There is no data to learn from yet.

| Component | Weight | Basis |
|---|---|---|
| Proximity | 30 | Linear decay across the current tier. Closer is better, but never decisive alone |
| Rating | 25 | `rating_avg` normalized. Workers with fewer than 5 ratings sit at the platform mean rather than at zero |
| Completion rate | 20 | Completed ÷ accepted. The strongest predictor of whether this task gets finished |
| Category experience | 12 | Completions in this category, with diminishing returns above roughly 20 |
| Response rate | 8 | Offers acted on ÷ offers received. Fast responders shorten time to match |
| Recency | 5 | Active in the last 24 hours ranks above dormant |

**Cold start.** A brand-new worker with no history is not sent to the bottom forever, or the marketplace never onboards anyone. New workers receive the platform mean on history-based components for their first five tasks, and a small explicit new-worker boost within the nearest tier. Onboarding supply is a launch priority and the ranking must not fight it.

**Ties** break by proximity, then by earlier `last_active_at`.

## Radius expansion

Notifying every worker in the city immediately trains them to ignore notifications. Expansion is staged.

| Tier | Radius | Offered to | Wait before expanding |
|---|---|---|---|
| 1 | 0–3 km | Top 10 | 10 minutes |
| 2 | 0–7 km | Next 15 | 15 minutes |
| 3 | 0–15 km | Next 25 | 20 minutes |
| 4 | 0–30 km | All eligible | Until deadline |

Each tier is a delayed BullMQ job carrying the task and tier. On acceptance, pending expansion jobs are cancelled. Timings compress automatically for tasks with a near deadline: a task due in 45 minutes does not spend 10 minutes in tier 1.

Every offer is recorded in `task_offers` with rank, score, distance and tier. That table is what makes response rate measurable, ranking auditable, and "why did I not see that task" answerable.

## Notification discipline

- At most one push per task per worker.
- Batched digests when several tasks match within a short window, rather than a burst of separate notifications.
- Respects notification preferences and, later, quiet hours.
- An offer that expires when someone else accepts is not a failure notification. Silence is better than telling someone they lost.

## Acceptance

Handled at the database level, as specified in `docs/06-database-design.md`: a single atomic conditional `UPDATE` that assigns only if the task is still unassigned. Zero rows affected means another worker won, which returns `409` and is presented as ordinary marketplace outcome, not an error.

No advisory locks, no `SELECT` then `UPDATE`, no application-level check-then-act. Those all have a window; the conditional update does not.

## Failure modes and responses

| Situation | Response |
|---|---|
| No eligible workers at all | Expand to the final tier immediately, alert operations. In a two-city launch this signals a supply gap needing manual recruitment |
| Offers made, nobody accepts | Expand tiers, then expire and refund with a repost prompt at a higher suggested budget |
| Repeated declines on a task | Flag for operations. Usually the budget is too low or the instructions are unclear |
| Worker accepts then abandons | Completion rate penalised, task returns to matching, previously offered workers are re-offered first |
| One worker sweeping every task | Concurrent task cap enforces breadth of supply |

## Deliberately not built

- **Worker bidding.** Adds a negotiation round trip to a marketplace with no liquidity and directly harms time to match.
- **Machine-learned ranking.** No training data exists, and a model cannot be explained to a worker who asks why they are ranked low.
- **Surge pricing.** Requires demand density that two cities will not produce.
- **Auto-assignment without acceptance.** Workers must choose. Assigned work they did not agree to is the fastest way to lose supply.

## Tuning

Weights, tier radii and timeouts are configuration, not code. They will be wrong at launch and must be adjustable without a deploy. The signals to watch are time to match, acceptance rate and completion rate by tier; if tier 1 acceptance is low, either the radius or the notification volume is wrong.
