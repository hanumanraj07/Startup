# 15 — Admin Panel

The admin console is not a later addition. At launch, KYC review and dispute resolution are entirely manual, which makes this the tool the business actually runs on.

It may be plain. It must be complete and fast.

## Access

`platform_role = ADMIN`, granted only by direct database action, never through a self-service path.

**Every admin write produces an audit log entry**: actor, IP, action, entity, before and after. No exceptions, including manual payment intervention.

Admin routes live under `/admin` in the web app, behind server-side role checks on every request. Hiding navigation is not access control.

## Dashboard

The operating picture, on one screen:

```
Users              12,450        Tasks today            382
Active workers      3,240        Completed              341
Verified (L2+)      1,890        In progress             34
                                 Disputed                 7

Completion rate     94.2%        GMV today          ₹4.2L
Median time to match  18m        Commission today   ₹63,000
Acceptance rate     31.4%        Pending payouts    ₹1.8L

KYC queue              23        Disputes open            7
Flagged tasks           4        Safety reports           1
```

Split by city, because Ahmedabad and Kolkata behave differently and an average of two cities describes neither.

Three numbers matter more than the rest, and they are the ones on which the launch is judged: **completion rate, time to match, dispute rate.**

## KYC review

The highest-volume daily task.

Queue sorted oldest first. Each item shows the document images and selfie side by side with the profile name, at full resolution, with a decision available without leaving the screen.

Decisions: approve, reject with a reason, or request resubmission. A reason is mandatory on rejection and is sent to the user.

Rules:

- Document images are fetched by **short-lived presigned URL**, never a permanent link.
- Document numbers stay encrypted and are shown only within this interface.
- Every decision is audited with the deciding admin's identity.
- Approval raises verification level to 2 and notifies the worker.

## Dispute resolution

Queue sorted by age, with the review target visible so ageing disputes are obvious.

Each dispute opens the complete evidence bundle from `docs/14-dispute-resolution.md`: instructions as published, chat, proof with server-computed GPS distances and timestamps, arrival records, status history, payment records, and both parties' histories.

Decision: release, refund, or split with amounts. **Reasoning is mandatory** and is sent to both parties.

The interface presents evidence identically to how both parties see it, so an admin cannot decide on information one side never had.

## Users

Search by name, email, phone, or identifier.

Each profile shows verification level and KYC history, task history in both roles, ratings, completion and response rates, payment and payout history, disputes, reports filed and received, and the audit trail of admin actions on the account.

Actions: suspend with a reason, ban, restore, adjust verification level, reset a stuck state.

**Suspension takes effect immediately.** `token_version` is bumped, invalidating outstanding access tokens rather than waiting for expiry.

## Tasks

Filter by status, city, category, risk level and flag.

**The high-risk review queue is the important one.** Tasks scored high risk are held before publication and appear here. Each shows the instructions, the risk flags that triggered the hold, the location and the requester's history. Decisions: allow, block with a reason, or request the requester rewrite.

Also available: force-expire a stuck task, reassign after abandonment, and view full status history. Task content is never silently edited; a change is recorded and both parties are informed.

## Payments and payouts

Search by task, user, or gateway identifier. Every record shows its full ledger entries, so an admin can see exactly where money is.

Actions: retry a failed payout, trigger a manual refund, and investigate a reconciliation mismatch.

**Ledger imbalance is surfaced as an incident, not a warning.** If any task's entries do not sum to zero, it appears here prominently. Manual money movement requires a reason and is audited in full.

## Safety and reports

Queue of reported users and safety incidents, with the task context and both parties' history.

Safety incidents are escalated above everything else in the queue. A worker reporting a safety problem during a task takes precedence over any commercial matter.

## Configuration

Editable without a deploy, because these will be wrong at launch:

| Setting | Note |
|---|---|
| Categories | Name, proof presets, suggested price range, active state |
| Cities | Launch scope. Adding a city is a business decision, made here |
| Commission rate | Applies to new tasks only. Existing tasks keep their stored rate |
| Verification thresholds | Task value bands per level |
| Matching weights, radii, tier timeouts | The tuning surface from `docs/10-matching-engine.md` |
| Statutory deduction rates | GST, TCS, TDS, set with professional advice |
| Cancellation compensation | Business decision |

Every configuration change is audited with before and after values.

## Metrics

| Metric | Why |
|---|---|
| Completion rate | The single most important number |
| Time to match, median and p90 | Requester confidence |
| Acceptance rate by radius tier | Whether matching is tuned correctly |
| Dispute rate | Trust, and margin |
| Repeat requester rate | Whether the product actually works |
| Active workers by city | Supply health |
| Tasks with no eligible workers | Direct signal for manual recruitment |
| GMV and commission | The business |
| Payout success rate | Operational health |

## Deliberately excluded

- Bulk user actions. Too easy to cause irreversible damage at speed.
- Direct database editing. Every change goes through an audited action.
- Deleting evidence, chat or ledger entries. Append-only means append-only, including for admins.
- Impersonating a user. If support needs a user's view, that is a read-only view, never the ability to act as them.
