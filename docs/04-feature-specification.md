# 04 — Feature Specification

Every feature, tagged. **MVP** ships at launch. **POST-MVP** follows once the core loop is proven. **FUTURE** is recorded so it is not confused with current scope.

Nothing tagged POST-MVP or FUTURE gets built without an explicit decision to move it. If you are reading this to decide whether to build something, the answer for anything not tagged MVP is no.

## Authentication and accounts

| Feature | Tag |
|---|---|
| Email and password signup and login | MVP |
| Email verification | MVP |
| Phone verification by OTP | MVP |
| Google sign-in | MVP |
| JWT access tokens with refresh rotation | MVP |
| Password reset | MVP |
| Session and device management | POST-MVP |
| Two-factor authentication | POST-MVP |

## Profile and verification

| Feature | Tag |
|---|---|
| Profile: display name, photo, city | MVP |
| Verification Level 1: email and phone | MVP |
| Verification Level 2: government ID and selfie, admin reviewed | MVP |
| Verification Level 3: address verification | POST-MVP |
| Verification Level 4: experienced worker, awarded on record | POST-MVP |
| Verification Level 5: professional tier | FUTURE |
| Automated KYC via DigiLocker or a verification API | POST-MVP |
| Bank or UPI payout details, PAN collection | MVP |
| Public trust profile: rating, completion rate, task count, member since | MVP |

## Task creation

| Feature | Tag |
|---|---|
| Create task with category, title, instructions | MVP |
| Task location via Places autocomplete, resolved to coordinates | MVP |
| Requester location stored separately from task location | MVP |
| Budget with a suggested range for category and city | MVP |
| Deadline | MVP |
| Proof requirements preset by category, adjustable | MVP |
| Reference image attachments | MVP |
| Save as draft | MVP |
| Edit before publication | MVP |
| Cancel with the refund rules | MVP |
| Prohibited-content screening at creation | MVP |
| Task risk scoring | MVP |
| Duplicate or repost a previous task | POST-MVP |
| Recurring tasks | FUTURE |
| Multi-stop tasks | FUTURE |

## Discovery and matching

| Feature | Tag |
|---|---|
| Nearby task feed using PostGIS radius search | MVP |
| Distance shown on every task card | MVP |
| Match scoring: distance, rating, completion rate, category experience, response rate | MVP |
| Filters: availability, verification level, category, standing | MVP |
| Radius expansion at 3, 7, 15 and 30 km when unaccepted | MVP |
| Notification batching so workers are not spammed | MVP |
| Worker working radius and category preferences | MVP |
| Accept task, with a database-level guarantee of exactly one winner | MVP |
| Decline with a reason, feeding future ranking | POST-MVP |
| Worker bidding | FUTURE |
| Machine-learned matching | FUTURE |

## Task execution

| Feature | Tag |
|---|---|
| Task state machine with server-enforced transitions | MVP |
| Mark en route | MVP |
| Confirm arrival with server-verified GPS | MVP |
| Proof checklist derived from requirements | MVP |
| Photo capture with GPS and timestamp metadata | MVP |
| Video capture | MVP |
| Structured proof fields: price, serial number, availability | MVP |
| Free-text notes | MVP |
| Presigned direct upload to object storage | MVP |
| Submit for review | MVP |
| Report a blocker | MVP |
| Live location sharing during execution | FUTURE (blocked on iOS background limits) |

## Review and completion

| Feature | Tag |
|---|---|
| Evidence viewer with GPS, timestamps and verification flags | MVP |
| Approve, releasing payment | MVP |
| Reject with a reason, requesting rework | MVP |
| Automatic approval 24 hours after submission | MVP |
| Database-backed sweeper so auto-approval survives queue loss | MVP |
| Two-way rating after completion | MVP |
| Written review | POST-MVP |

## Payments

| Feature | Tag |
|---|---|
| Razorpay Route integration | MVP |
| Capture and hold before publication | MVP |
| Release on approval | MVP |
| Double-entry ledger, balancing to zero per task | MVP |
| Platform commission calculation | MVP |
| Statutory deduction lines, configurable, ready for GST, TCS and TDS | MVP |
| Worker payout | MVP |
| Refunds: cancellation, expiry, dispute | MVP |
| Webhook signature verification | MVP |
| Idempotency on every money operation | MVP |
| Payment failure and retry handling | MVP |
| Worker earnings history and statements | MVP |
| Wallet balance and withdrawal | POST-MVP |
| Instant payout at a fee | POST-MVP |

## Communication

| Feature | Tag |
|---|---|
| In-app chat, scoped to an assigned task | MVP |
| Contact detail redaction: phone, email, UPI | MVP |
| Image sharing in chat | MVP |
| Realtime delivery over Socket.IO with the Redis adapter | MVP |
| Chat retained as dispute evidence | MVP |
| Masked calling | FUTURE |
| Voice notes | FUTURE |

## Notifications

| Feature | Tag |
|---|---|
| Web Push for installed PWAs | MVP |
| Email for account and payment events | MVP |
| In-app notification centre | MVP |
| Per-event channel routing | MVP |
| Preferences and unsubscribe | MVP |
| Transactional SMS | POST-MVP (needs DLT registration) |
| Quiet hours | POST-MVP |

## Trust and safety

| Feature | Tag |
|---|---|
| Prohibited-task rules enforced at creation | MVP |
| Task risk scoring: low, medium, high | MVP |
| High-risk tasks held for manual review | MVP |
| Report a user | MVP |
| Block a user | MVP |
| Account suspension | MVP |
| Worker safety rules: no isolated locations, no late-night meetings | MVP |
| Rating and trust score | MVP |
| Fraud pattern detection | POST-MVP |
| Background verification | FUTURE |

## Disputes

| Feature | Tag |
|---|---|
| Raise a dispute within the review window | MVP |
| Payment frozen on dispute | MVP |
| Automatic evidence bundle assembly | MVP |
| Both parties submit their account | MVP |
| Admin decision: release, refund, or split | MVP |
| Decision recorded with reasoning | MVP |
| Appeal | POST-MVP |
| Automated dispute triage | FUTURE |

## Admin

| Feature | Tag |
|---|---|
| KYC review queue | MVP |
| Dispute queue with evidence | MVP |
| User management: search, view, suspend | MVP |
| Task oversight and moderation | MVP |
| Payment and payout oversight | MVP |
| Operations dashboard: completion rate, time to match, dispute rate, GMV, active workers | MVP |
| Category and pricing configuration | MVP |
| Manual payment intervention with an audit trail | MVP |
| Worker recruitment tooling | POST-MVP |
| Analytics and cohort reporting | POST-MVP |

## Platform and infrastructure

| Feature | Tag |
|---|---|
| PWA install, service worker, offline shell | MVP |
| Dark mode | MVP |
| Responsive across mobile and desktop | MVP |
| Rate limiting by endpoint class | MVP |
| Audit logging of security-sensitive actions | MVP |
| Structured logging and error tracking | MVP |
| Health checks | MVP |
| k6 load testing | MVP |
| Native mobile app | FUTURE |
| Public API for business customers | FUTURE |
| Multi-language, Hindi and Bengali | POST-MVP |

## Deliberately excluded from MVP

Stated plainly, because each is a plausible-sounding addition that would harm the launch:

- **Cash handling or purchasing on a requester's behalf.** Changes the liability model entirely.
- **Task categories beyond the launch six.** Every new category brings unfamiliar fraud and safety modes.
- **Worker bidding.** Adds a negotiation round trip to a marketplace with no liquidity.
- **Machine-learned matching.** There is no data to learn from yet. A transparent scoring formula is debuggable; a model is not.
- **Wallets and stored balances.** Holding user balances is a heavier regulatory obligation than escrowing a single transaction.
