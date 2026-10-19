# Changelog

Notable changes to OnSite. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — 2026-10-19 · P4: verification

- **Verify your identity with DigiLocker** in about a minute, instead of waiting for a document review. We keep only your name and the last four digits of your Aadhaar. Uploading documents is still available.
- **Bank accounts and UPI IDs are checked** before any money is sent: the account must exist and be in your own verified name. Clear reasons when a check fails, and "Check again".
- Payouts wait until both your identity and your account are verified; your earnings stay safe until then.

### Added — 2026-10-19 · P3: pricing and payouts

- **Set your own price.** The requester types what they will pay for the task (from ₹100); category price ranges are gone.
- **"Buy something for me"** on pickup & delivery tasks: an item budget of up to ₹10,000 is held with the task payment. The worker pays at the shop, sends a receipt photo and the actual cost, and gets it back with their earnings; anything unspent is refunded. No commission is taken on the item.
- **Commission is no longer shown** to requesters or workers. Requesters see what they pay; workers see what they earn.
- **Worker payouts:** add a bank account or UPI ID, see what is ready, on the way and paid, tap "Pay out", and see every payout with its reference or the reason it failed. Failed payouts retry automatically.

### Fixed — 2026-10-19

- Icon-only buttons (proof delete, chat send) drew their icon 4 px wide.
- A worker's "My tasks" list showed the task's gross price.
- A dispute decided for the worker credited them in the ledger but never queued the payout.

### Added — 2026-10-19 · P2: real-time requests and tracking

- **Incoming task requests** pop up for nearby workers with a 90-second countdown, the payout, distance and (for deliveries) the trip. The first to accept gets it; everyone else's request closes with "Another worker accepted this one first". If a whole wave declines, the next wider wave goes out at once.
- **Instant "worker accepted"** alert for the requester anywhere in the app.
- **Live worker location** on a map for the requester from "On my way" until arrival (and while a delivery is being carried), with the distance to go. Only the latest point is kept.
- **Task page as steps and tabs**: a "Now" card with the next action, the live map, and Progress, Details, Payment and Chat tabs. Deliveries get their own steps (heading to pickup, at the pickup, delivering).

### Fixed — 2026-10-19

- Tasks past their deadline are no longer offered to workers.

### Added — 2026-10-19 · P1: maps, pickup & delivery

- **Map-based location picker** on OpenStreetMap: search for a shop or street, jump by state and city, or use your current location, then drag the map until the pin is on the exact spot. Replaces the latitude/longitude boxes.
- **Pickup & delivery tasks**: a new category with a pickup and a drop-off point, shown as a route in the wizard, the feed ("Deliver 5.5 km to …") and the task page, with Directions links for the assigned worker.
- **Searchable dropdowns** for state and city, covering every state and union territory.
- Workers set and change their exact starting point on a map (Feed → Change).

### Fixed — 2026-10-19

- **Tasks showing up for workers far outside the area.** The feed now measures only from a worker's saved starting point and radius, and starting points are no longer forced to a city centre.
- The feed's area label no longer ends in a bare PIN code.

### Added — 2026-10-18 · P0: moderation, leaving and removing, sessions that last

- **Task moderation** on every create, edit, payment and publish: keyword rules that see through disguised spellings, plus the OpenAI Moderation API when `OPENAI_API_KEY` is set. A blocked task shows the reason and starts a 5-minute posting pause enforced by the API. Users can ask for a human review; admins decide at `/admin/moderation`.
- **Workers can leave** a task they accepted (until they submit proof), with a reason; it goes back to other workers and their completion rate drops.
- **Requesters can remove the worker** before they arrive; the task goes back to matching and the payment stays held.
- New notifications: worker left, removed from a task, moderation review outcome.

### Fixed — 2026-10-18

- **Being signed out when coming back to the site.** The login cookie was a third-party cookie in production and two tabs refreshing at once looked like token theft. API calls now go through the site's own domain, and a just-rotated token presented twice within 30 seconds is treated as a duplicate, not theft.
- Prohibited-content rules no longer block legitimate items like "glue gun", "drug store" or "forged alloy wheels".

### Added — 2026-09-07 · Specification layer

The complete documentation layer, written before any application code so that architecture and business rules are settled rather than re-invented during implementation.

**Product and business**
- `docs/01-product-requirements.md` — problem, solution, users, launch scope, success metrics
- `docs/02-business-model.md` — 15% commission, unit economics, Indian tax obligations, future revenue
- `docs/03-user-flows.md` — requester, worker and admin journeys with edge cases
- `docs/04-feature-specification.md` — every feature tagged MVP, POST-MVP or FUTURE
- `docs/17-mvp-scope.md` — explicit include and exclude lists, launch definition of done
- `docs/18-future-roadmap.md` — six phases through to the physical-world task API

**Technical**
- `docs/05-system-architecture.md` — frozen stack, process split, quarantined concerns
- `docs/06-database-design.md` — full schema, PostGIS columns, indexes, the three core queries
- `docs/07-api-specification.md` — every endpoint with auth, validation and rate limits
- `docs/08-authentication-authorization.md` — roles, verification levels, permission matrix
- `docs/09-task-lifecycle.md` — the state machine with actors, preconditions and side effects
- `docs/10-matching-engine.md` — filters, scoring weights, radius expansion, race prevention
- `docs/11-payment-flow.md` — escrow, double-entry ledger, idempotency, failure handling
- `docs/16-security-requirements.md` — checkable rules and the pre-launch checklist
- `docs/20-scalability-performance.md` — the 1,000 concurrent user plan and load tests

**Trust and operations**
- `docs/12-trust-safety.md` — verification levels, prohibited tasks, risk scoring, worker safety
- `docs/13-notification-system.md` — the event-to-channel matrix
- `docs/14-dispute-resolution.md` — evidence bundle, decision standards, timelines
- `docs/15-admin-panel.md` — the tool the business actually runs on at launch

**Design**
- `docs/19-ui-design-system.md` — brand, tokens, components, the four signature screens

**AI development rules**
- `ai/project-context.md` — invariants that must not be broken
- `ai/architecture-rules.md` — the architectural constitution
- `ai/coding-rules.md` — code standards
- `ai/task-generation-rules.md` — the read-before-write workflow
- `ai/memory.md` — decision log with reasoning and rejected alternatives

**Root**
- `README.md` replacing the stub, `CLAUDE.md`, `TODO.md`, `CHANGELOG.md`, `.gitignore`, `.env.example`

### Decisions recorded

Full reasoning in `ai/memory.md`.

- Product named **OnSite**
- **Web + PWA** rather than a native mobile app, with the constraint that shared packages stay runtime-neutral
- **Prisma** with all PostGIS SQL quarantined in one repository, since Prisma has no native geography type
- **Razorpay Route** rather than plain Checkout, because Indian rules prohibit pooling customer funds in an ordinary current account
- **Google Places for geocoding, OpenStreetMap for display**, keeping the paid quota where accuracy matters
- **Integer paise with a double-entry ledger** balancing to zero per task
- **Database-backed deadlines with sweepers**, so a lost queue job cannot mean a worker is never paid
- Launch scope held to **remote inspection and verification, Ahmedabad and Kolkata**

---

## Notes

Versioning begins at the first deployable build. Until then, dated entries under Unreleased.
