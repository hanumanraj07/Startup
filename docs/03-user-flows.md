# 03 — User Flows

Every major journey through OnSite. These are the contract the interface implements.

## Requester: first task, end to end

```
Sign up (email + password, or Google)
   ↓
Verify email
   ↓
Verify phone (required before funding any task)
   ↓
Create task
   ├── Category                 (from the six launch categories)
   ├── Task location            (Places autocomplete → exact coordinates)
   ├── Title and instructions   (what to do, and explicitly what not to do)
   ├── Proof requirements       (preset by category, adjustable)
   ├── Budget                   (suggested range shown for category and city)
   └── Deadline
   ↓
Review: budget, platform commission, what the worker receives
   ↓
Pay  ← funds captured and held here, BEFORE the task is visible to any worker
   ↓
Task published → matching begins
   ↓
Notified: worker assigned  (worker's name, rating, verification level, completion history)
   ↓
Watch live status: en route → arrived → in progress
   ↓
Chat with the worker if clarification is needed
   ↓
Notified: proof submitted
   ↓
Review evidence  (photos, video, notes, GPS, timestamps)
   ↓
   ├── Approve   → payment released → rate the worker
   ├── No action → auto-approved after 24 hours → payment released
   └── Dispute   → payment frozen → admin review
```

**The critical ordering.** Funds are captured before publication. A task no worker can be paid for must never appear in a worker's feed.

### Requester edge cases

| Situation | Behaviour |
|---|---|
| Payment fails | Task stays a draft. Never published, never shown |
| Nobody accepts before deadline | Task expires, full refund, requester offered a repost at a suggested higher budget |
| Cancel before assignment | Full refund |
| Cancel after assignment | Refund minus worker compensation. Rate is a business decision, see `docs/02-business-model.md` |
| Worker abandons | Task returns to matching, requester notified, no additional charge |
| Requester never reviews | Auto-approval at 24 hours protects the worker |

## Worker: first task, end to end

```
Sign up
   ↓
Verify email and phone                → Verification Level 1
   ↓
Submit KYC (government ID, selfie)    → Verification Level 2 after admin review
   ↓
Add payout details (bank or UPI, PAN)
   ↓
Set up work profile
   ├── Base location
   ├── Working radius   (default 10 km)
   ├── Categories
   └── Availability
   ↓
Browse nearby tasks  (ranked by match score, distance shown on every card)
   ↓
Open a task: full instructions, proof requirements, payout, deadline, requester rating
   ↓
Accept   ← exactly one worker can win this. Task disappears from every other feed
   ↓
Navigate to the task location
   ↓
Confirm arrival    ← GPS captured and verified against the task location server-side
   ↓
Execute, working through the proof checklist
   ├── Photos      (captured in-app, GPS and timestamp attached)
   ├── Video
   ├── Structured fields  (price, serial number, availability)
   └── Notes
   ↓
Submit
   ↓
Wait for review (at most 24 hours, then auto-approval)
   ↓
Approved → payout initiated → rate the requester
```

### Verification gates

A worker's verification level determines the value of task they may accept. Enforced server-side at acceptance, not merely hidden in the interface.

| Task value | Minimum level |
|---|---|
| Up to ₹1,000 | Level 1 — email and phone verified |
| ₹1,000 to ₹5,000 | Level 2 — KYC approved |
| Above ₹5,000 | Level 3 — address verified |

### Worker edge cases

| Situation | Behaviour |
|---|---|
| Two workers accept simultaneously | Exactly one wins. The other gets a clear message, not an error |
| Arrival GPS far from the task location | Not blocked outright. Recorded, flagged, surfaced in dispute review. A shop's mapped pin is often wrong, and punishing the worker for it would be unjust |
| Cannot complete the task | Report a blocker with evidence. Partial compensation is an admin decision |
| Abandons silently | Task reassigned after the deadline, completion rate penalised |
| Requester disputes | Payment frozen, worker submits their account, admin decides |

## Administrator

```
KYC queue        → review document and selfie → approve, reject with reason, or request resubmission
Dispute queue    → read the evidence bundle → decide → release, refund, or split
Task moderation  → review flagged tasks against prohibited rules → allow or block
Safety reports   → review incidents → suspend accounts where needed
Operations       → completion rate, time to match, dispute rate, GMV, active workers by city
```

The dispute evidence bundle is assembled automatically and is identical for both sides: task instructions as published, the full chat, all proof with GPS and timestamps, arrival records with measured distance, the state transition history, and the payment record.

## The moments that decide whether this product works

Four points carry disproportionate weight. They get the most design and engineering care.

1. **The first task creation.** A requester who has never used the service is deciding whether to trust it while filling in a long form. If it feels heavy or ambiguous, they leave and there is no second chance.
2. **Payment before publication.** The moment money is committed to a stranger. It must be explicit about what is charged, what is held, when it is released, and what happens if the task is not done.
3. **Waiting for a match.** Silence reads as failure. The requester needs to see that the task is being actively distributed and how far the radius has expanded.
4. **Reviewing the evidence.** This is where the product either proves itself or does not. The evidence must be presented as verified fact, with its GPS and timestamps visible, not as a gallery of pictures a stranger uploaded.
