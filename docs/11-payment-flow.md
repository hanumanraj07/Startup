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

## What each side sees (founder decision, 2026-10-19)

**The requester sets the task payment** themselves; there are no per-category price ranges, only a platform floor of ₹100 (`MIN_TASK_BUDGET_PAISE`) and ceiling of ₹50,000. **The commission is never shown to requesters or workers.** The requester sees what they pay: the task payment, any item budget, and the total. The worker sees what they earn, and any item money apart from it. Neither API projection contains the commission or the other side's figure; admins see the full split.

## Buying an item (pickup & delivery only, 2026-10-19; bill approval since P6, 2026-10-20)

A pickup & delivery task may include an **item budget**: what the requester expects the item to cost, up to ₹10,000 (`MAX_ITEM_BUDGET_PAISE`). The requester pays **task payment + item budget**, captured together in escrow.

P3 had the worker pay at the shop with their own money and report the cost at submission. That was replaced (ai/memory.md, 2026-10-20): the worker carried up to ₹10,000 of risk, the cost was whatever they typed, and a colluding pair could move money between themselves with a fake receipt. Since P6:

1. **The worker pays nothing at first.** At the shop they send a **bill** (`ItemPurchase`): a photo of the bill or price tag, the amount, what it is, and how the shop will be paid.
2. **The requester approves the exact amount**, within `ITEM_BILL_APPROVAL_MINUTES` (default 10), or rejects it. A bill above what is left of the budget is approved with a **top-up**: the requester pays the difference then (its own gateway order, captured into the same escrow). Unanswered, the bill expires and the worker may withdraw it and walk away without penalty. A price change or a substitute is simply another bill.
3. **Approved, the shop is paid.**
   - `SHOP_UPI` (the default): OnSite pays the shop's UPI ID straight from escrow through the payout partner. Item money goes to a shop, never to a person; the worker's own UPI ID is refused. Needs a payout partner (`PAYOUT_PROVIDER`), so it is unavailable while that is `none`.
   - `WORKER_CASH` (the shop takes only cash): the worker pays, capped by level (`cashPurchaseCapPaise`: ₹2,000 up to level 2, ₹5,000 at level 3, ₹10,000 from level 4). If a UPI payment fails, the worker may retry it or switch to cash within the cap; the approved amount never changes.
4. **Handover.** Approval gives the requester a 4-digit **handover code**, never shown to the worker. The worker enters it at the drop-off to submit; five wrong codes lock it (then Report an issue). A cash bill is repaid to the worker **as soon as the code is entered**, as its own payout, not on approval.
5. **On approval of the task**, commission is taken **on the task payment only**, the worker is owed their earnings, and whatever item money escrow still holds is refunded. That figure is read from the ledger's escrow balance, never from a reported cost.

For the founder's example (₹1,000 item budget, ₹200 task payment, 15% commission) with an approved ₹950 cash bill:

| When | Account | Amount |
|---|---|---|
| Capture | `REQUESTER_FUNDS` / `ESCROW` | −120000 / +120000 |
| Handover code entered | `ESCROW` / `ITEM_REIMBURSABLE` | −95000 / +95000 |
| Reimbursement payout | `ITEM_REIMBURSABLE` / `ITEM_PASS_THROUGH` | −95000 / +95000 |
| Task approved | `ESCROW` | −25000 |
| | `PLATFORM_COMMISSION` | +3000 |
| | `WORKER_PAYABLE` (earnings only) | +17000 |
| | `REFUND` (unspent item money) | +5000 |

With `SHOP_UPI` the shop payment is one group when the transfer is confirmed: `ESCROW` −amount, `ITEM_PASS_THROUGH` +amount. A top-up is `REQUESTER_FUNDS` −x, `ESCROW` +x. `ITEM_PASS_THROUGH` is item money that left the platform for goods; it is never income and never commissioned, and earnings payouts never contain it.

**Disputes.** Once a bill is approved and the handover code entered, the item cost cannot be taken back: the requester agreed the amount and confirmed the item. Without a handover:
- *Release to worker* or *split*: an approved cash bill is repaid to the worker in full first (the requester agreed it); a split's percentage divides the task payment only; item money still held is refunded.
- *Refund to requester*: everything escrow still holds is refunded, including an approved cash bill never repaid (the admin judged the item did not arrive). A bill already paid to a shop has left escrow; recovering it is an admin judgement outside the ledger.

A worker cannot leave a task once a bill is approved (Report an issue instead), and a bill still awaiting an answer blocks submission. Cancellation after assignment is not available in this build, so there is no cancel-after-purchase case. Gateway fees on item money and top-ups are borne by the platform; GST/TCS/TDS treatment of item pass-through needs a chartered accountant's confirmation before launch.

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

How this is built (`payments/payouts.service.ts`, 2026-10-19): a `payouts` row is created `PENDING` at release, with the item reimbursement recorded apart from earnings (`reimbursement_paise`). It is sent to the worker's **verified default** payout account (bank account or UPI ID): immediately after release, and by the worker-process sweep every minute for accounts verified later, failed transfers (backoff 5 / 30 / 60 minutes, up to `PAYOUT_MAX_ATTEMPTS`) and transfers left in `PROCESSING` for 15 minutes. A transfer is claimed with a conditional update before anything is sent, so two processes cannot send the same payout. Only a confirmed transfer writes `WORKER_PAYABLE → WORKER_SETTLED` and moves the task to `PAYMENT_RELEASED`. Workers can also tap "Pay out", which retries failures at once.

`PAYOUT_PROVIDER`: `mock` settles instantly (an account number ending 0000 is declined, to exercise failures); `none` keeps payouts owed and visible until a payout partner is connected, and is the default in production. The real partner (RazorpayX Payouts or Route linked accounts) and bank-account verification are P4 work.

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

### How a refund reaches the requester (2026-10-20, docs/22 #4)

The ledger entry is the decision; the money is sent by the gateway. Until 2026-10-20 only the first half existed: refunds were booked and never sent.

1. **Outbox.** Every credit to the `REFUND` account writes a `refunds` row in the same database transaction (`LedgerService.writeEntries`). No refund can be booked without one, whichever flow books it.
2. **Allocation.** The gateway refunds each captured payment separately and never more than it captured, so the amount is split across the task's own payment first, then item top-ups, oldest first, net of earlier refunds. One row is one gateway refund.
3. **Sending.** The sweeper (`RefundsService.sweep`, every minute) sends due rows at normal speed (free), with our row id in the refund's notes and receipt. Each attempt is claimed with a conditional update, so two replicas never both send. A retry first asks the gateway for a refund carrying the row's id and adopts it, so a call that timed out after reaching the gateway is never sent twice.
4. **Settlement.** `refund.processed` / `refund.failed` webhooks settle the row; anything still pending after 30 minutes is polled. A failed gateway refund is sent again with backoff (1 minute up to 12 hours, 8 attempts); after the last it is logged as an error for a person.
5. **Mock gateway.** Settled at once.

Statuses: `PENDING` → `PROCESSING` (gateway accepted) → `PROCESSED`; `FAILED` is retried. Refunds booked before this existed have no row and were never sent; production used Razorpay test keys throughout, so no real money is affected.

## Failure handling

| Failure | Response |
|---|---|
| Payment fails | Task stays `DRAFT`. Never published, never shown to a worker |
| Webhook never arrives | `PaymentsService.reconcilePending` (every sweeper tick) asks the gateway about task payments and item top-ups still unpaid after 5 minutes, up to 3 days old, and records a capture exactly as the webhook would. **The webhook is the fast path; polling is the guarantee** |
| Webhook arrives twice | Deduplicated on event id, and the capture itself is a conditional claim in one transaction with its escrow entry, so two deliveries arriving together record it once |
| Webhook arrives out of order | Payment state transitions are guarded; a stale event cannot move state backwards. `payment.failed` only fails a payment not yet captured |
| The same money moved twice | Refund, release and dispute settlement each claim the payment before writing a ledger entry, and the ledger refuses any write that would take a task's escrow below zero |
| Crash between a status and its money | The stranded-money sweep refunds or releases a finished task whose payment is still held, the way a dispute decided when there was one |
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
