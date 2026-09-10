# 11 — Payment Flow

The highest-risk area in the system. Everything here is designed on the assumption that networks fail mid-transaction, gateways replay webhooks, and clients lie.

## Regulatory position, which shapes the design

**A marketplace in India cannot hold customer money in an ordinary current account.** Pooling funds between a requester who has paid and a worker awaiting payout requires a nodal or escrow arrangement.

OnSite therefore uses **Razorpay Route**: the full task amount is captured, held against the platform within Razorpay's regulated structure, and transferred to the worker on approval with the commission retained.

**This is paperwork, not engineering.** Real money movement requires a registered business entity, Razorpay KYC and Route activation. The entire flow below is built and tested end to end against test mode and a mock driver without any of it.

**Rejected:** plain Checkout plus manual bank transfers. That puts pooled customer funds in a normal current account, which is a compliance problem rather than a shortcut.

## Money flow

```
Requester
   │ ₹500
   ▼
Razorpay  ──────────► captured and held      ← task becomes visible to workers ONLY after this
   │
   │ worker completes, requester approves (or 24h auto-approval)
   ▼
Release
   ├─► ₹425 transferred to the worker
   └─► ₹75  retained as commission
```

The single most important ordering rule: **funds are captured before a task is published.** A task no worker can be paid for must never appear in a feed.

## Representation

- All amounts are `bigint` paise. ₹500 is `50000`. Never a float, never rupees in storage.
- All arithmetic lives in `packages/money`, used identically by the API and the web app, so the fee a requester is quoted is the fee they are charged.
- Commission rate is stored **on the task** in basis points at creation. Changing the platform rate never alters historical tasks.
- All money movement goes through `ledger.service.ts`. Nothing else writes ledger entries.

## Double-entry ledger

Every movement writes balanced signed entries. **The sum of `amount_paise` for any task must be exactly zero**, asserted in tests and by a periodic reconciliation job.

For a ₹500 task at a 15% commission:

**Capture**

| Account | Amount |
|---|---|
| `REQUESTER_FUNDS` | −50000 |
| `ESCROW` | +50000 |

**Release on approval**

| Account | Amount |
|---|---|
| `ESCROW` | −50000 |
| `PLATFORM_COMMISSION` | +7500 |
| `WORKER_PAYABLE` | +42500 |

**Payout processed**

| Account | Amount |
|---|---|
| `WORKER_PAYABLE` | −42500 |
| `WORKER_SETTLED` | +42500 |

Sum across all entries: zero. Each group balances independently, so a partially completed flow still balances.

**Gateway fee**, charged to the platform, not the worker:

| Account | Amount |
|---|---|
| `PLATFORM_COMMISSION` | −1000 |
| `GATEWAY_FEE` | +1000 |

**Refund on cancellation or expiry**

| Account | Amount |
|---|---|
| `ESCROW` | −50000 |
| `REFUND` | +50000 |

**Split dispute resolution**, worker awarded 50%:

| Account | Amount |
|---|---|
| `ESCROW` | −50000 |
| `WORKER_PAYABLE` | +21250 |
| `PLATFORM_COMMISSION` | +3750 |
| `REFUND` | +25000 |

The ledger is **append-only**. A correction is a new entry, never an update. An audit trail that can be edited is not an audit trail.

Statutory deduction accounts, `GST_PAYABLE`, `TCS_PAYABLE` and `TDS_PAYABLE`, exist from day one with rates configured at zero. Adding them later becomes configuration rather than a schema migration under a tax deadline. See `docs/02-business-model.md`, and have a chartered accountant confirm the rates before launch.

## Sequence

**1. Order creation.** The requester finishes a draft task and pays. The server computes the amount **from the task record**, never from the request body, creates a gateway order, and writes a `payments` row as `CREATED` with a required idempotency key.

**2. Payment.** The requester pays through the gateway. The browser returning from the redirect **changes nothing**. It triggers a refresh of server state, that is all.

**3. Capture, by webhook.** The gateway calls the webhook. Signature is verified before anything else is read. The event is inserted on its unique `event_id`; a conflict means it was already processed and is acknowledged without reprocessing. The payment becomes `CAPTURED`, ledger entries are written, and the task becomes publishable.

**4. Publication.** `DRAFT → PUBLISHED` verifies captured funds against the payment record. This is the gate.

**5. Release.** On approval or 24-hour auto-approval, within one database transaction: the task moves to `COMPLETED`, the payment to `RELEASED`, release ledger entries are written, and a `payout.process` job is queued. Queuing inside the transaction means a rollback cannot leave a payout job for a release that did not happen.

**6. Payout.** The worker transfer is initiated with its own idempotency key. On success the task reaches `PAYMENT_RELEASED`. On failure it is retried with backoff, and a sweeper catches payouts stuck in `PROCESSING`.

## Idempotency

**Every money operation carries an idempotency key.** Retries are inevitable: users double-click, networks time out ambiguously, queues redeliver.

- `payments.idempotency_key` and `payouts.idempotency_key` are unique columns. The database, not application logic, is what prevents duplicates.
- Webhook events deduplicate on `webhook_events.event_id`.
- A replayed request returns the original result rather than creating a second charge.

Webhook replay is not hypothetical. Gateways deliberately redeliver when they do not receive a prompt acknowledgement, so replay-safety is a normal operating condition.

## Refunds

| Trigger | Refund |
|---|---|
| Task expires unaccepted | 100% |
| Requester cancels before assignment | 100% |
| Requester cancels after assignment | 100% minus worker compensation. Rate is a business decision, see `docs/02-business-model.md` |
| Worker abandons | 100%, or the task returns to matching at the requester's choice |
| Dispute resolved for the requester | 100% |
| Dispute split | Per the admin decision |

Refunds are idempotent and produce their own ledger entries. A partial refund never leaves the ledger unbalanced.

## Failure handling

| Failure | Response |
|---|---|
| Payment fails | Task stays `DRAFT`. Never published, never shown to a worker |
| Webhook never arrives | Reconciliation job polls the gateway for pending payments older than 10 minutes. **The webhook is the fast path; polling is the guarantee** |
| Webhook arrives twice | Deduplicated on event id |
| Webhook arrives out of order | Payment state transitions are guarded; a stale event cannot move state backwards |
| Payout fails | Retried with backoff. After repeated failure, flagged for admin intervention with an audit trail |
| Release succeeds, payout job lost | The stuck-payout sweeper finds `COMPLETED` tasks with no processed payout |
| Ledger does not balance | Reconciliation job alerts. This is treated as a serious incident, not a warning |

## Non-negotiable rules

1. **The client never determines payment state.** Only a signature-verified webhook or a server-initiated fetch.
2. **The client never supplies an amount.** Amounts are computed server-side from the task.
3. **No task is published before capture.**
4. **Every money operation is idempotent.**
5. **Every movement writes balanced ledger entries.**
6. **Webhook signatures are verified before the payload is read.**
7. **Money never moves outside `ledger.service.ts`.**
8. **Nothing is logged that contains card data, full account numbers, or gateway secrets.**

## Testing

- Full lifecycle against test mode: order, capture, publish, release, payout.
- Ledger balances to zero for every scenario, including partial refunds and splits.
- Replayed webhooks produce no second charge.
- Out-of-order webhooks do not corrupt state.
- Fee arithmetic exhaustively unit tested, including rounding at awkward values.
- A dispute raised immediately before the auto-approval deadline prevents release.
- Auto-approval fires from the sweeper when the queue job is deleted outright.
