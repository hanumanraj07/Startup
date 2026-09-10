# Coding Rules

## TypeScript

- TypeScript everywhere. `strict` is on and stays on.
- No `any`. If a type is genuinely unknown, use `unknown` and narrow it. If an external library forces it, isolate the cast in one adapter file with a comment explaining why.
- No non-null assertions (`!`) to silence the compiler. If a value can be absent, handle the absence.
- Prefer `type` for shapes, `enum` only where the value is persisted and shared with the database.
- Shared types live in `packages/types` and are imported by both the API and the web app. A type defined twice will drift.

## API code

- Every endpoint validates its input with a Zod schema from `packages/validation`. Validation is shared with the web app so the two never disagree about what is valid.
- Controllers are thin: validate, call one service method, return a projection.
- Services hold business logic and are unit testable without HTTP.
- Repositories hold data access. Services do not write Prisma queries inline.
- `async`/`await` only. No raw promise chains.
- Errors are typed domain errors mapped to HTTP status codes in one exception filter. Never throw a bare string, and never leak an internal error message to a client.
- Every response body is an explicit projection. Never return a Prisma entity directly.

## Web code

- Server Components by default. Reach for `"use client"` only where interactivity requires it.
- No business logic in components. Components render state and dispatch intent.
- Data fetching goes through a typed API client, never `fetch` scattered through components.
- Every interactive element is keyboard reachable and labelled. Accessibility is a requirement, not a later pass.
- Every list that can grow is paginated or virtualized. No unbounded renders.

## Money

- Currency is always integer paise, in a variable named so the unit is unmistakable, such as `amountPaise`.
- All fee and split arithmetic lives in `packages/money`. It is pure, exhaustively unit tested, and used identically by the API and the web app so the fee a requester is quoted is the fee they are charged.
- Rounding rules are defined once in that package. Rounding decided ad hoc at call sites is how marketplaces end up a rupee short.

## Naming

- Say the unit and the frame: `amountPaise`, `distanceMeters`, `radiusMeters`, `deadlineAtUtc`.
- Booleans read as assertions: `isVerified`, `hasSubmittedProof`.
- Database tables and columns are `snake_case`. TypeScript is `camelCase`. Prisma maps between them.

## Testing

Not everything needs a test. These do, and they are not optional:

- The task state machine, including every illegal transition being rejected.
- All money arithmetic: fees, splits, refunds, partial cancellation.
- The ledger balancing to zero.
- Concurrent task acceptance resolving to exactly one winner.
- Authorization: each role attempting what it must not be allowed to do.
- PII projections, asserted over whole response bodies so a new column cannot quietly leak.
- Webhook handling, including replayed and out-of-order deliveries.
- The geo query returning correct workers by distance, tested against a seeded set with known distances.

## Configuration

- All secrets come from environment variables. Never hardcode a key, and never commit a real one.
- Every variable is declared in `.env.example` with a comment explaining it.
- Environment is parsed and validated once at startup with a schema. The process refuses to boot on missing or malformed configuration rather than failing mysteriously at 2am.

## Hygiene

- Small, focused modules. A file doing several unrelated things gets split.
- Do not duplicate logic. If it appears twice, it belongs in a shared package.
- Delete dead code rather than commenting it out. Git remembers.
- Comments explain why, not what. The code already says what.
- No `console.log` in committed code. Use the structured logger, and never log tokens, OTPs, full card data, KYC document numbers or bank details.
