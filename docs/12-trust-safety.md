# 12 — Trust and Safety

Trust is not a feature of this product. It is the product. The technology is straightforward; convincing someone to send money and intent through a stranger in another city is not.

## Verification levels

| Level | Requires | Grants |
|---|---|---|
| 0 | Registered | Browse only |
| 1 | Email verified | Post tasks. Accept up to ₹1,000 |
| 2 | Government ID and selfie, admin approved | Accept ₹1,000 to ₹5,000 |
| 3 | Address verified | Accept above ₹5,000 |
| 4 | 50+ completions, ≥4.5 rating, ≥95% completion rate | Priority ranking, higher-value work |
| 5 | Professional tier, manually granted | Reserved for business customers |

**Verification requirements scale with what is at stake.** A ₹200 photograph does not warrant KYC friction; a ₹5,000 property inspection does. Enforced server-side at acceptance by reading the database, never from a token claim.

**Launch note:** level 1 originally required phone verification alongside email. Deliberately relaxed to email-only for launch — SMS OTP requires DLT registration in India, a real one-time compliance cost, and it isn't worth paying before there's revenue to justify it. Phone verification is still fully built (`/auth/phone/send-otp`, `/auth/phone/verify-otp`) and still available to any user who wants it; it is simply no longer a hard gate on reaching level 1. Revisit once DLT registration is in place.

## KYC

Accepted documents: Aadhaar, PAN, driving licence, voter ID, passport.

Submission is document front, document back where applicable, and a selfie. Admin review compares the selfie to the document photo and checks the name matches the profile.

Handling rules, which are not negotiable:

- Document images live in object storage under keys that are **never public URLs**. Access is by short-lived presigned GET, only for admin review.
- Document numbers are **encrypted at rest** and never returned by any API, including to the user who submitted them.
- Document images are never exposed to the other party in a task, ever.
- Rejection always carries a reason, and resubmission is allowed.
- Every KYC decision writes an audit log entry naming the deciding admin.

**Automated verification (built 2026-10-19, P4).** The quick route is **DigiLocker through Cashfree Secure ID**: the worker consents in DigiLocker to share their Aadhaar, and is verified to level 2 at once. Only the name on the record and the last four digits are kept: never the Aadhaar number, address, date of birth or photo. Five attempts a day, then the manual route. The **manual upload above remains** the fallback and the only route when no provider is configured (`VERIFICATION_PROVIDER=none`, the production default until a provider contract is in place).

**Payout accounts are checked against the verified identity.** Adding a bank account or UPI ID needs level 2. The provider confirms the account exists and returns the holder's name, which must match the verified name; an account in anyone else's name is refused ("payouts can only go to an account in your own name"), which closes the mule-account route. Payouts go only to a checked account of a level 2+ worker. See `ai/memory.md` (P4) for the provider research and the reasons Razorpay was not used for this.

## Trust score

What a requester sees before entrusting a task:

```
Rahul S.                    ⭐ 4.92  ·  187 tasks

Success rate      98.4%
Identity          ✓ Verified
Phone             ✓ Verified
Email             ✓ Verified
Payment history   ✓ Good
Member since      March 2026
```

Composed from rating average, completion rate, verification level, task count, tenure and dispute history. **Displayed as components, not as a single opaque number**, because a requester deciding whether to trust someone needs to know which parts are strong.

Ratings are two-way. A requester who disputes without cause, cancels repeatedly after assignment, or writes unclear instructions accumulates a record that workers can see.

## Prohibited tasks

Never permitted, regardless of payment:

- Anything illegal
- Weapons, ammunition, explosives
- Controlled substances, prescription medicines without authorization
- Financial fraud, money laundering, unexplained cash movement
- Impersonating another person or an official
- Unauthorized access to property, systems or data
- Surveillance, following or photographing a person without consent
- Anything endangering the worker
- Collecting or transporting valuables above the task value
- Sexual or exploitative content
- Anything requiring a professional licence the worker does not hold

**Buying an item for the requester is allowed since 2026-10-19** (founder decision), but only through the **item budget** on a pickup & delivery task: held in escrow with the task payment, capped at ₹10,000. Since P6 (2026-10-20) nothing is bought until the requester approves the exact bill the worker sends from the shop; the platform then pays the shop's UPI ID directly (never the worker's own), or, only where a shop takes nothing but cash, the worker pays within a level-based cap and is repaid once the requester's handover code is entered. The worker never states what the item cost. See `docs/11-payment-flow.md`. **Still excluded:** cash handling beyond that capped shop payment, a worker handing the requester money or lending it (blocked by the screening rules), and items above the cap. A worker carrying ₹80,000 of someone else's money is still a different and harder business.

### How screening works (decided 2026-10-18, see `ai/memory.md`)

Screening runs on **every task write**: create, edit and publish, server-side in `modules/moderation/moderation.service.ts`, so no client or screen can skip it.

1. **Keyword and pattern rules** (`tasks/risk.service.ts`), checked against the text as written *and* a normalised copy that undoes disguises: digit-for-letter swaps (`k1ll`), spaced or dotted letters (`k.i.l.l`), zero-width characters and look-alike Unicode. A short list of benign phrases (`glue gun`, `drug store`, `forged alloy wheels`, `kill switch`, …) is removed first, so legitimate items that merely contain a sensitive word are not blocked. Every entry on that list is a hole in the filter and must be justified by a real everyday use.
2. **OpenAI Moderation API** (`omni-moderation-latest`), only when `OPENAI_API_KEY` is set, and only if the rules passed. It fails open: an outage or timeout leaves the rules as the only check rather than stopping all posting. Task text is sent to OpenAI when it is enabled.
3. **A block is a block.** The task is not created (or the edit or publish is refused), the user sees the reason in plain language, and the attempt is recorded as a `moderation_events` row plus a `PROHIBITED_TASK_BLOCKED` audit entry with the full text.
4. **Five-minute posting pause.** After a block the user cannot create, edit, fund or publish any task for `MODERATION_COOLDOWN_SECONDS` (default 300). Enforced by the API from `moderation_events.restricted_until`, never by the UI alone, so resubmitting or editing around the block does not work. Each new violation starts a new pause.
5. **Appeal.** Within 7 days the user can ask for a human review with a short explanation. Admins see appeals at `/admin/moderation`, with the original text and how many blocks the user had in the last 24 hours. Overturning lifts the pause at once and lets *that exact content* (hashed, case and whitespace folded) through for that user; upholding keeps the block. Both are audited and the user is notified.

Not built, deliberately: automatic bans or reports to authorities on a match. Repeated blocks are surfaced to admins (count in the last 24 hours), and suspension stays a human decision under *Reporting and enforcement* below.

## Task risk scoring

| Level | Characteristics | Handling |
|---|---|---|
| 🟢 Low | Standard category, daylight, commercial location, ordinary value | Published automatically |
| 🟡 Medium | High value, unusual instructions, residential location, evening | Published with a worker advisory |
| 🔴 High | Isolated location, late night, cash or valuables mentioned, prohibited-pattern hit, unverified requester at high value | **Held for manual review before publication** |

Inputs: category, value, time of day, location type, instruction content, requester history and verification level.

## Worker safety

The platform sends real people to real places, and a marketplace that treats that casually will eventually cause harm.

- **No isolated locations.** Task locations are checked against place type. Remote or unmapped locations are escalated.
- **No late-night personal meetings.** Tasks between 9 PM and 7 AM at non-commercial locations require review.
- **No tasks framed as meeting an individual privately.** Verification happens at businesses and properties, not private rendezvous.
- **Workers may decline anything, at any point, for any reason,** without a completion-rate penalty when they report a safety concern.
- **In-task safety reporting** is available from the task screen throughout execution.
- **Cancelling on arrival for safety reasons** is compensated, not penalised. A worker who fears a penalty will stay somewhere unsafe, and no completion metric is worth that.

## Privacy between parties

**The requester never receives:** the worker's home address, coordinates, phone number, email, KYC documents or bank details.

**The worker never receives:** the requester's home address, coordinates, phone number or email.

**They share:** the task location, display names, ratings, verification levels, and in-app chat.

**One deliberate exception: the worker's live position during a trip** (founder decision, 2026-10-18/19). It is shared with the requester only from the moment the worker taps "On my way" until arrival, and for pickup & delivery also while the item is carried to the drop-off — never between accepting and setting off, which would often reveal where the worker lives. The worker sees a banner while it is on. Only the latest point is kept, in Redis with a two-minute expiry, and it is broadcast only to the task's room; no trail is stored. It is a convenience view, never evidence: arrival and proof GPS remain the record for disputes.

Enforced by explicit response projections rather than by remembering to omit fields, and asserted by tests over whole response bodies so that a column added next month cannot quietly leak.

**Contact details are redacted in chat.** Phone numbers, email addresses and UPI identifiers are stripped server-side and flagged. This is not paternalism: a transaction taken off-platform loses escrow, evidence and dispute recourse, and the person who suffers is almost always the worker.

## Reporting and enforcement

| Action | Effect |
|---|---|
| Report a user | Enters the safety queue with the task context |
| Block a user | Mutual exclusion from matching, permanently |
| Safety incident | Immediate escalation, task frozen, admin review |
| Fraud report | Payments frozen pending review |

| Enforcement | Trigger |
|---|---|
| Warning | First minor violation |
| Feature restriction | Repeated cancellation or poor completion |
| Suspension | Serious violation, fraud suspicion, safety incident |
| Permanent ban | Confirmed fraud, safety violation, prohibited task |

Suspension takes effect **immediately**, not at token expiry. `token_version` is bumped so outstanding access tokens are invalidated at once.

Every enforcement action records the acting admin, the reason and the evidence.

## Abuse patterns to watch

Recorded now, monitored manually at launch, automated post-MVP:

- Repeated small tasks between the same pair, which usually indicates off-platform payment or money movement
- A requester disputing an unusual share of tasks
- A worker whose proof photographs are visually near-identical across tasks
- Accounts sharing a device fingerprint or payout account
- Task instructions that pass keyword screening but describe a prohibited outcome
- Rating manipulation between colluding accounts

## Assumptions being made

Stated so they can be revisited rather than forgotten:

- Manual KYC and dispute review are viable at launch volume and will not be at scale.
- Keyword screening catches obvious prohibited tasks and will miss cleverly worded ones. Manual review is the backstop.
- GPS is evidence, not proof. It can be spoofed, so it is weighed alongside photographs, timestamps and chat rather than trusted alone.
