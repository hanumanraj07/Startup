# Changelog

Notable changes to OnSite. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
