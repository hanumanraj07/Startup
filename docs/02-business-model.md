# 02 — Business Model

## How OnSite makes money

A commission on each completed task. The requester pays the task budget. The worker receives the budget minus the platform's take rate.

**Launch take rate: 15%.**

| | ₹500 task | ₹1,000 task | ₹2,000 task |
|---|---|---|---|
| Requester pays | ₹500 | ₹1,000 | ₹2,000 |
| Platform commission (15%) | ₹75 | ₹150 | ₹300 |
| Worker receives | ₹425 | ₹850 | ₹1,700 |

All amounts are stored as integer paise. A ₹500 task is `50000`. Fee arithmetic lives in `packages/money` and nowhere else, so the fee quoted to a requester and the fee actually charged cannot diverge.

## Why commission rather than a requester service fee

The founder document raised both. The choice matters strategically.

**Chosen: commission deducted from the worker's payout.** The requester sees one clean number, which is what they compare against the cost of travelling. Price clarity matters most on the side that has to be convinced to try an unfamiliar service.

**The tension, stated honestly.** Worker supply is the harder side to build, and a 15% deduction is felt most by the people the marketplace can least afford to lose early. If worker acquisition stalls, the first lever to pull is a reduced or waived commission for early workers, funded as a customer acquisition cost, not a permanent price change.

**Rejected for now: a visible requester service fee on top of the budget.** It makes the platform's margin explicit at exactly the moment a first-time requester is deciding whether to trust the service.

**Not decided by engineering.** The rate is configurable per task at creation time and stored on the task, so historical tasks keep the rate they were created under. Changing the rate is a business decision, never a migration.

## Pricing model

**Launch: the requester sets the budget.** Simplest to build and to explain. The worker sees the amount and decides.

The platform assists rather than dictates: the task creation flow shows a suggested range for the category and city, derived from completed task history. Suggestion only, never enforcement.

**Rejected for launch: worker bidding.** It adds a negotiation round trip to a marketplace that has no liquidity yet, and slows time to match, which is a launch metric.

**Later: platform-calculated pricing**, once there is enough completion data for base fee, distance, duration and complexity to be modelled honestly. See `docs/18-future-roadmap.md`.

## Indian tax and regulatory obligations

**These require a chartered accountant's confirmation before launch. Rates and thresholds change, and the numbers below are a starting point for that conversation, not authoritative advice.**

Three obligations apply to a marketplace of this kind and each affects the money flow, so they are engineering concerns and not only finance ones:

| Obligation | What it means here | Where it lands |
|---|---|---|
| **GST on commission** | The platform's commission is a taxable service. GST is charged on the commission, not on the full task value | Increases the effective take, must appear on invoices |
| **TCS under GST** | E-commerce operators collect tax at source on the net value of supplies facilitated and remit it | A deduction in the payout path |
| **TDS under section 194-O** | E-commerce operators deduct tax at source on payments to participants, with thresholds and PAN or Aadhaar conditions | A deduction in the payout path, and a reason worker PAN collection matters |

The consequence for the build: the payout calculation is **not** simply budget minus commission. It is budget, minus commission, minus statutory deductions, each recorded as its own ledger entry so remittance and reconciliation are possible without reverse-engineering them later. The ledger is designed for this from the start even while the deduction rates are configured at zero pending professional advice.

## Unit economics

Per ₹1,000 task at launch scale:

| Line | Amount |
|---|---|
| Commission revenue | ₹150 |
| Payment gateway fee (approx. 2% of ₹1,000) | −₹20 |
| Payout transfer fee | −₹3 to −₹5 |
| Notification and infrastructure cost per task | roughly −₹2 |
| **Contribution before GST, support and fraud** | **roughly ₹123** |

Two conclusions follow directly, and both shape the product:

1. **Low-value tasks barely contribute.** A ₹200 task yields ₹30 of commission and loses much of it to fixed per-transaction costs. This argues for a minimum task value, suggested at ₹300, rather than chasing volume that costs money to serve.
2. **Disputes are the real cost line.** A dispute consumes manual review time worth many completed tasks' contribution. Every trust and proof feature is therefore also a margin feature, which is why they are in the MVP rather than deferred.

## Future revenue

Nothing here is built at launch. Recorded so it is not confused with current scope.

| Line | Description | Phase |
|---|---|---|
| **Business accounts** | Companies commissioning ground verification instead of sending an employee. Compelling economics: ₹8,000 of travel against ₹1,500 | Phase 4 |
| **Priority matching** | Paying for the task to reach the strongest workers first | Phase 3 |
| **Verified professional tier** | Higher-verification workers for high-value tasks, at a premium | Phase 3 |
| **Detailed reporting** | Structured inspection reports rather than raw evidence | Phase 4 |
| **API access** | Programmatic submission of physical-world tasks. The largest long-term opportunity | Phase 5 |
| **Subscriptions** | Recurring volume commitments from businesses | Phase 4 |

## The B2B opportunity, and why it is not the launch

An Amazon seller in Gujarat needing inventory inspected in Kolkata, or a Delhi company verifying a Mumbai supplier's warehouse, compares OnSite against ₹8,000 of employee travel rather than against asking a friend. Better margins, higher volumes, repeat usage, less price sensitivity.

It is not the launch market because business customers demand reliability that must be earned on consumer tasks first. A business will not commission supplier verification from a marketplace whose completion rate is unproven. Consumer tasks build the worker base and the trust record that make the B2B pitch credible.

## What must be true for this business to work

1. Strangers will pay strangers ₹500 to ₹1,000 for physical tasks. **This is the assumption to test first, ideally by brokering tasks manually over WhatsApp before relying on the platform.**
2. Enough workers exist near enough task locations to match quickly.
3. Completion rate stays high enough that requesters return.
4. Dispute rate stays low enough that manual resolution does not consume the margin.

If the first assumption is false, no amount of engineering fixes it.
