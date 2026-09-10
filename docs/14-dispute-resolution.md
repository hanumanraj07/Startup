# 14 — Dispute Resolution

Disputes are unavoidable in a marketplace where strangers transact on physical outcomes. How they are handled determines whether either side ever returns.

## Flow

```
Worker submits proof
       ↓
Requester raises a dispute (within the review window)
       ↓
PAYMENT FROZEN IMMEDIATELY  ← auto-approval cancelled, payout blocked
       ↓
Evidence bundle assembled automatically
       ↓
Both parties invited to submit a statement (48 hours)
       ↓
Admin reviews
       ↓
Decision: release to worker · refund to requester · split
       ↓
Money moves, ledger entries written, both parties notified with reasoning
```

**The freeze is immediate and unconditional.** A dispute raised one second before the 24-hour auto-approval deadline must win that race. The auto-approval job and the sweeper both check for an open dispute **inside the same transaction as the release**, not before it.

## Who can dispute, and when

| Party | Window | Typical grounds |
|---|---|---|
| Requester | From submission until 7 days after completion | Work not done, evidence insufficient or falsified, instructions not followed |
| Worker | From submission until 7 days after rejection | Unfair rejection, requester unresponsive, instructions changed after acceptance |

A dispute after auto-approval and payout is still accepted, but resolution shifts to recovery rather than a simple release decision, which is one reason payout is not instant.

## The evidence bundle

Assembled automatically and **identical for both parties and the admin**. Neither side sees a version the other cannot.

| Evidence | Why it matters |
|---|---|
| Task instructions **as published** | The contract. Settles most "you did not ask for that" disputes outright |
| Full chat history, with redaction flags | Shows what was actually agreed during execution |
| All proof: photos, video, notes, structured fields | The work itself |
| **Server-computed GPS distances** and geofence results | Where the worker actually was, measured by PostGIS, not claimed by the client |
| Capture and upload timestamps, with implausibility flags | Whether evidence was gathered at the location or assembled later |
| Arrival records | When and where the worker confirmed arrival |
| Full status transition history with actors | Exactly what happened and who did it |
| Payment and ledger records | What was charged, held and owed |
| Both parties' history: rating, completion rate, prior disputes | Pattern, not just this incident |

Because this bundle is assembled from data the system records as a matter of course, **most disputes resolve on facts rather than on who argues more persuasively.** That is the entire point of requiring structured proof.

## Decisions

| Decision | When | Money |
|---|---|---|
| **Release to worker** | Instructions followed, proof adequate | Full payout, commission retained |
| **Refund to requester** | Work not done, or evidence shows it was not done as specified | Full refund, no payout, commission not taken |
| **Split** | Partially completed, or both parties bear responsibility | Proportional. **The platform normally waives its commission on a split**, since a partial failure is partly the platform's matching failure |

Every decision records the deciding admin, the reasoning, and the evidence relied upon. Both parties receive the reasoning, not merely the outcome. A decision without an explanation reads as arbitrary and loses both users regardless of who won.

## Standards of judgment

Written down so decisions stay consistent between admins and over time:

- **Instructions govern.** If the requester did not ask for it, the worker was not obliged to do it. Vague instructions are the requester's risk, which is why the creation flow works hard on clarity.
- **GPS discrepancy alone does not decide anything.** Mapped shop pins are routinely wrong by 50 metres or more. Weigh it against photographs, timing and chat.
- **Absent evidence weighs against the party who was required to produce it.** A worker who submitted no photographs where photographs were required has not met the requirement.
- **Timestamps carry weight.** Proof captured hours after the claimed arrival, or uploaded long after capture, is a genuine signal.
- **History matters, but does not decide.** A pattern of disputes is relevant. A first dispute from a good worker is not evidence of anything.
- **When genuinely balanced, split.** A wrong all-or-nothing decision loses a user permanently. A split loses trust from neither side completely.

## Timelines

| Stage | Target |
|---|---|
| Freeze | Immediate, automatic |
| Statement window | 48 hours |
| First admin review | Within 24 hours of the statement window closing |
| Resolution | Within 5 days of the dispute being raised |
| Money moved after decision | Immediately |

A dispute that sits unresolved costs more trust than an unfavourable decision delivered quickly.

## Abuse of the process

| Pattern | Response |
|---|---|
| A requester disputing an unusual share of tasks | Flagged, reviewed, restricted |
| A worker disputing every rejection | Flagged, reviewed |
| Either party fabricating evidence | Immediate ban, payments frozen |
| Threatening the other party into withdrawing | Immediate suspension |

Dispute rate by user is tracked from launch precisely because this pattern is easier to catch early than retroactively.

## Cost, and why it shapes the product

A dispute consumes manual review time worth many completed tasks' contribution margin. **Every proof and trust feature is therefore also a margin feature**, which is why structured proof requirements, GPS verification and clear instructions are in the MVP rather than deferred as polish.

Target dispute rate is under 5% of completed tasks. Above that, the problem is upstream in matching, instruction clarity or proof requirements, and the fix belongs there rather than in faster adjudication.

## Automation, later

At launch, disputes are entirely manual. That is correct: there is no data yet to automate against, and early disputes teach more about the product than any metric.

Post-MVP, once patterns are visible: automatic triage by evidence completeness, flagging of clear-cut cases for fast resolution, and suggested outcomes for admin confirmation. **Never fully automated adjudication.** A wrong automated decision about someone's earnings is a trust failure no efficiency gain justifies.
