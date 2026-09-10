# 12 — Trust and Safety

Trust is not a feature of this product. It is the product. The technology is straightforward; convincing someone to send money and intent through a stranger in another city is not.

## Verification levels

| Level | Requires | Grants |
|---|---|---|
| 0 | Registered | Browse only |
| 1 | Email and phone verified | Post tasks. Accept up to ₹1,000 |
| 2 | Government ID and selfie, admin approved | Accept ₹1,000 to ₹5,000 |
| 3 | Address verified | Accept above ₹5,000 |
| 4 | 50+ completions, ≥4.5 rating, ≥95% completion rate | Priority ranking, higher-value work |
| 5 | Professional tier, manually granted | Reserved for business customers |

**Verification requirements scale with what is at stake.** A ₹200 photograph does not warrant KYC friction; a ₹5,000 property inspection does. Enforced server-side at acceptance by reading the database, never from a token claim.

## KYC

Accepted documents: Aadhaar, PAN, driving licence, voter ID, passport.

Submission is document front, document back where applicable, and a selfie. Admin review compares the selfie to the document photo and checks the name matches the profile.

Handling rules, which are not negotiable:

- Document images live in object storage under keys that are **never public URLs**. Access is by short-lived presigned GET, only for admin review.
- Document numbers are **encrypted at rest** and never returned by any API, including to the user who submitted them.
- Document images are never exposed to the other party in a task, ever.
- Rejection always carries a reason, and resubmission is allowed.
- Every KYC decision writes an audit log entry naming the deciding admin.

Automated verification through DigiLocker or a KYC API is post-MVP. Manual review is slower but correct, and at launch volume one person can do it.

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

**Also excluded at launch, though not unlawful:** purchasing on the requester's behalf and any task where the worker fronts money. The founding example ends with "do NOT purchase it" deliberately. A worker carrying ₹80,000 of someone else's money is a fundamentally different and harder business.

Screening runs at task creation against keyword and pattern rules. Matches escalate to manual review rather than silent rejection, since automated screening produces false positives and a wrongly blocked legitimate task loses a customer.

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
