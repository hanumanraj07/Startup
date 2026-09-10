# 09 — Task Lifecycle

A task is a state machine. **Every status write goes through `apps/api/src/modules/tasks/transitions.ts`.** No service sets a status directly. If the state machine can be bypassed, it is decoration rather than a guarantee.

## States

```
DRAFT
  ↓ publish (requires captured payment)
PUBLISHED
  ↓ matching begins
MATCHING
  ↓ accept
ASSIGNED
  ↓ en route
WORKER_EN_ROUTE
  ↓ arrive (GPS verified server-side)
ARRIVED
  ↓ begin
IN_PROGRESS
  ↓ submit (all required proof present)
SUBMITTED ──────────────► UNDER_REVIEW
  ↓ approve, or auto-approve at 24h        (informational: requester opened it.
COMPLETED                                   The 24h clock still runs from SUBMITTED)
  ↓ payout processed
PAYMENT_RELEASED
```

Branches:

```
DRAFT                          → CANCELLED   (requester, before payment)
PUBLISHED, MATCHING            → CANCELLED   (requester, full refund)
PUBLISHED, MATCHING            → EXPIRED     (deadline passed, nobody accepted)
ASSIGNED … IN_PROGRESS         → CANCELLED   (requester, refund minus worker compensation)
ASSIGNED … IN_PROGRESS         → MATCHING    (worker abandons, task re-offered)
SUBMITTED, UNDER_REVIEW        → IN_PROGRESS (requester rejects, rework requested)
SUBMITTED, UNDER_REVIEW        → DISPUTED    (either party, payment frozen)
COMPLETED                      → DISPUTED    (within the window)
DISPUTED                       → COMPLETED | CANCELLED   (admin decision)
```

## Transitions

Every transition names its actor, its precondition, and its side effects. Anything not listed here is illegal and is rejected with `422`.

| From → To | Actor | Precondition | Side effects |
|---|---|---|---|
| `DRAFT → PUBLISHED` | Requester | **Payment captured and held.** Task passes prohibited screening. Location inside an active city. Deadline in the future | `published_at` set, `task.match` job queued, `task.expire` job scheduled at deadline |
| `PUBLISHED → MATCHING` | System | Matching job started | Offers created for the first radius tier, top workers notified |
| `MATCHING → ASSIGNED` | Worker | **Atomic conditional update.** Task unassigned, worker available, verification level sufficient, not blocked by requester | `assigned_worker_id` and `assigned_at` set, exact location revealed to the assignee, requester notified, other offers expired, chat opened, radius expansion cancelled |
| `ASSIGNED → WORKER_EN_ROUTE` | Assignee | Assigned | Requester notified |
| `WORKER_EN_ROUTE → ARRIVED` | Assignee | Coordinate supplied. **Server measures distance with PostGIS** | `arrival_records` row written with server-computed distance and geofence result. Requester notified |
| `ARRIVED → IN_PROGRESS` | Assignee | Arrived | |
| `IN_PROGRESS → SUBMITTED` | Assignee | **Every required proof present.** Validated against the task's requirements | `submitted_at` set, **`review_deadline_at = submitted_at + 24h`**, `task.autoApprove` job scheduled, requester notified |
| `SUBMITTED → UNDER_REVIEW` | Requester | Requester opened the submission | Informational only. **Does not change the deadline** |
| `SUBMITTED / UNDER_REVIEW → COMPLETED` | Requester | Approval | Payment released, commission recorded, ledger entries written, `payout.process` queued, worker notified |
| `SUBMITTED / UNDER_REVIEW → COMPLETED` | System | `review_deadline_at` passed, no dispute open | Same as approval. Reason recorded as auto-approval |
| `SUBMITTED / UNDER_REVIEW → IN_PROGRESS` | Requester | Rejection with a reason | Worker notified with the reason. **The 24h clock restarts on resubmission** |
| `COMPLETED → PAYMENT_RELEASED` | System | Payout processed by the gateway | Worker notified, earnings updated |
| `* → DISPUTED` | Party | Within the dispute window | **Payment frozen immediately.** Auto-approval cancelled, evidence bundle assembled, admin queue notified |
| `DISPUTED → COMPLETED` | Admin | Decision favours the worker, wholly or in part | Release or split executed, both parties notified with reasoning |
| `DISPUTED → CANCELLED` | Admin | Decision favours the requester | Refund executed |
| `PUBLISHED / MATCHING → CANCELLED` | Requester | Not yet assigned | Full refund, offers expired |
| `ASSIGNED … IN_PROGRESS → CANCELLED` | Requester | Assigned | Refund minus worker compensation. Worker notified |
| `ASSIGNED … IN_PROGRESS → MATCHING` | Assignee or System | Worker abandons or goes unresponsive past deadline | Assignment cleared, completion rate penalised, task re-offered, requester notified |
| `PUBLISHED / MATCHING → EXPIRED` | System | Deadline passed unassigned | Full refund, requester notified and offered a repost at a higher suggested budget |

## Rules the machine enforces

**A task is never visible to a worker before funds are captured.** The `DRAFT → PUBLISHED` precondition is the only gate, and it is checked against the payment record on the server, never against a client claim.

**Exactly one worker can win.** Acceptance is a single atomic conditional `UPDATE`. Losers receive `409` and a clear message, not an error screen.

**Submission is validated, not asserted.** The server checks each required proof exists before allowing `SUBMITTED`. A worker cannot submit an empty task.

**The 24-hour clock is a database column, not a queue entry.** `review_deadline_at` is authoritative. The BullMQ delayed job is the fast path; a sweeper running every 60 seconds catches anything the queue lost. Without the sweeper, a Redis incident means a worker silently never gets paid, and nobody discovers it until they complain.

**A dispute stops the clock.** Auto-approval checks for an open dispute before releasing, and the check happens inside the same transaction as the release. A dispute raised seconds before the deadline must not lose the race.

**Rejection restarts the clock.** A requester cannot extend indefinitely by rejecting repeatedly; the rework path is capped and repeated rejections escalate to a dispute.

**GPS mismatch flags, it does not block.** Arrival with a large distance is recorded and surfaced, never silently rejected. Mapped shop pins are often wrong by 50 metres or more, and blocking the worker would punish them for the map's error. The evidence goes to the requester and into the dispute bundle where a human can weigh it.

## Terminal states

`PAYMENT_RELEASED`, `CANCELLED` and `EXPIRED` are terminal. `COMPLETED` is terminal for the work but not for money, since payout may still fail and retry, which is exactly why `PAYMENT_RELEASED` is a separate state rather than an assumption.

## Testing

The state machine is where correctness is cheapest to guarantee and most expensive to lose. Required tests:

- Every legal transition succeeds under its precondition.
- **Every illegal transition is rejected.** This is the larger and more important half.
- Preconditions are enforced independently: publishing without captured payment, accepting above verification level, submitting without required proof, approving a task that is not submitted.
- Concurrency: fifty simultaneous accepts yield exactly one success.
- Auto-approval fires from the sweeper when the queue job is deleted outright.
- A dispute raised immediately before the deadline prevents release, with both the job and the sweeper running.
