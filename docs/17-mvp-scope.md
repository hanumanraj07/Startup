# 17 — MVP Scope

The most useful file in this repository for keeping work in bounds.

**If a feature is not listed under Include, it is not being built.** Not "not yet prioritized". Not being built. Proposals go to `docs/18-future-roadmap.md`.

## The MVP in one sentence

A requester in Ahmedabad can post a funded inspection task at a specific location in Kolkata, a verified worker nearby can find and accept it, complete it with photo, video and GPS evidence, and be paid automatically on approval.

If that works reliably, the concept is proven. If it does not, no additional feature rescues it.

## Include

**Accounts and verification**
- Email and password signup, Google sign-in, email verification, phone OTP
- JWT with rotating refresh tokens and reuse detection
- Profile, worker profile, payout details
- Verification levels 1 and 2, with KYC submission and admin review
- Task value thresholds enforced by verification level

**Tasks**
- Creation with the six launch categories only
- Task location via Places autocomplete, stored separately from requester location
- Budget with a suggested range, deadline, instructions, reference attachments
- Proof requirements preset by category and adjustable
- Prohibited-content screening and risk scoring
- Draft, publish, cancel, expire

**Matching**
- PostGIS radius search for the worker feed
- Scored ranking across distance, rating, completion rate, category experience, response rate, recency
- Radius expansion at 3, 7, 15 and 30 km
- Notification batching
- Atomic acceptance with exactly one winner

**Execution**
- Full state machine, server-enforced
- En route, arrival with server-verified GPS
- Photo, video, note and structured-field proof
- Presigned direct upload to object storage
- Submission validated against required proof

**Review and payment**
- Evidence viewer with GPS, timestamps and verification flags
- Approve, reject with a reason, 24-hour auto-approval with a database-backed sweeper
- Razorpay Route escrow: capture, hold, release
- Double-entry ledger balancing to zero
- Worker payout, refunds, webhook verification, idempotency
- Two-way ratings

**Communication**
- In-app chat scoped to assigned tasks, with contact-detail redaction
- Realtime over Socket.IO with the Redis adapter
- Web Push, email, in-app notification centre

**Trust, disputes, admin**
- Trust profile, prohibited rules, risk scoring, reporting, blocking, suspension
- Dispute with payment freeze, evidence bundle, admin decision
- Admin console: KYC queue, dispute queue, users, tasks, payments, metrics, configuration

**Platform**
- Installable PWA, dark mode, responsive
- Rate limiting, audit logging, structured logs, error tracking, health checks
- k6 load testing to the 1,000 concurrent user target

## Do not include

Each of these sounds reasonable, and each would harm the launch.

| Excluded | Why |
|---|---|
| Any category beyond the launch six | Every category brings unfamiliar fraud and safety modes |
| Any city beyond Ahmedabad and Kolkata | Liquidity spread thin is liquidity nobody experiences |
| Purchasing on a requester's behalf, or cash handling | A worker carrying someone's ₹80,000 is a different, harder business |
| Worker bidding | A negotiation round trip in a marketplace with no liquidity, and it worsens time to match |
| Machine-learned matching | No training data exists, and a model cannot explain itself to a worker who asks why they rank low |
| Wallets or stored balances | Holding user balances is a much heavier regulatory obligation than escrowing one transaction |
| Native mobile app | The PWA covers Android, which is roughly 95% of this market |
| Public or business API | Requires reliability that must be earned on consumer tasks first |
| Subscriptions and business accounts | Nothing to subscribe to until the core loop is proven |
| Referral programme | Amplifies whatever the product currently is. Amplify it after it works |
| Advanced analytics | The admin metrics answer the questions that matter at this stage |
| Multi-language | English at launch, Hindi and Bengali once the loop is proven |
| Masked calling | In-app chat is sufficient and cheaper |
| SMS notifications | Requires DLT registration. Push and email cover launch |
| Automated KYC | Manual review is correct at launch volume |
| Address verification, level 3 | Only needed above ₹5,000, which is above the expected launch range |
| Appeals on disputes | Volume does not justify it yet |
| Surge pricing | Requires demand density two cities will not produce |
| Live worker tracking | Blocked by iOS background limits, and discrete GPS checkpoints are enough |

## Launch definition of done

The MVP is complete when all of the following are true:

- [ ] The full Ahmedabad-to-Kolkata scenario runs end to end in a live environment with real accounts
- [ ] Payment captures, holds and releases correctly in Razorpay test mode, with the ledger balancing
- [ ] Auto-approval fires reliably, including when the queue job is deleted
- [ ] Fifty concurrent accepts yield exactly one winner
- [ ] No cross-party PII appears in any response, asserted by tests
- [ ] k6 scenarios pass at the 1,000 concurrent user target
- [ ] Admin can review KYC and resolve a dispute end to end
- [ ] The PWA installs on Android and receives push
- [ ] Every item on the security pre-launch checklist is complete
- [ ] Twenty workers are recruited and verified in Kolkata

The last item is not an engineering task and is the one most likely to be underestimated. **The marketplace does not work without supply, and no amount of code substitutes for recruiting the first twenty workers by hand.**

## Before writing code, consider not writing code

The founder document recommends testing the concept by brokering tasks manually over WhatsApp before relying on the platform. That recommendation is sound and remains open.

The question the MVP cannot answer, but a week of manual brokering can, is whether people will pay ₹500 to ₹1,000 for this at all. If they will not, the platform does not fix it. See the open questions in `ai/memory.md`.
