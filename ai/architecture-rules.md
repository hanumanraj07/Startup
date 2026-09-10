# Architecture Rules

The constitution of this codebase. These rules override convenience, and they override any suggestion that a shortcut is fine "just for now."

## Boundaries

**The client never reaches the database.** No direct database access from the web app, ever. Every read and write goes through the API.

**Business logic lives in the API's service layer.** Not in controllers, not in React components, not in database triggers, not in the client.

**Controllers stay thin.** A controller validates its input, calls one service method, and shapes the response. If a controller contains a conditional about business rules, it is in the wrong place.

**Shared packages stay runtime-neutral.** `packages/types`, `packages/validation`, `packages/money` and `packages/utils` must not import Node built-ins or assume a DOM. A native mobile app is a plausible future and this constraint is cheap now and expensive to retrofit.

## Trust

**Authorization is checked server-side on every protected endpoint.** Hiding a button in the UI is not access control. Every endpoint independently verifies the caller is allowed to act on that specific resource, not merely that they are logged in.

**The client cannot determine payment state.** Payment state changes only from a signature-verified webhook or a server-initiated fetch to the gateway. A success redirect from the browser is a hint to refresh, nothing more.

**The client cannot determine task state.** Clients call intent endpoints such as accept, arrive or submit. The server evaluates preconditions and decides. Every status write goes through `transitions.ts`.

**The client cannot set prices.** Budget, platform fee and payout amounts are computed and stored server-side. A client-supplied amount is used only as an input to validate, never as a value to trust.

**Client GPS is verified, not accepted.** On arrival and on every proof upload, the server measures the reported coordinate against the task location using PostGIS and records both the distance and a verification flag. A mismatch does not silently pass and does not silently fail; it is recorded as evidence for dispute review.

## Data

**All money is integer paise.** Never floats for currency. Formatting to rupees happens at the display layer only.

**All money movement is double-entry.** Every capture, release, fee, refund and payout writes balanced ledger rows. A task's ledger entries must sum to zero. This is asserted in tests.

**All timestamps are UTC in the database.** Timezone conversion happens at the display layer.

**Spatial columns are PostGIS `geography(Point, 4326)`** with GIST indexes. Latitude and longitude are stored alongside for convenience, but proximity queries use the geography column, never arithmetic on latitude and longitude.

**Raw SQL is confined to the geo repository.** Prisma does not support PostGIS types, so spatial queries need `$queryRaw`. That is acceptable only inside `geo.repository.ts`, behind typed wrappers. Raw SQL anywhere else needs a written justification.

## Privacy

**Responses are projections, not entities.** Never serialize a database entity directly to a client. Every response is built from an explicit projection that lists what it includes. This is what stops a column added next month from silently leaking.

**Cross-party data is minimal by default.** The worker's view of a task contains the task location and the requester's display name and rating. It does not contain requester email, phone, home address or home coordinates. The requester's view of a worker contains display name, rating, verification level and completion history. It does not contain phone, email, home address, KYC documents or bank details.

**Contact details are redacted in chat.** Phone numbers, email addresses and UPI identifiers in messages are redacted server-side and flagged, because taking the transaction off-platform removes every protection both sides have.

## Reliability

**The request path does no fan-out.** Creating a task returns as soon as the task is persisted. Finding and notifying matching workers happens in a background job.

**Media never passes through the API.** Uploads go browser-to-object-storage via presigned URLs. The API issues the URL and records metadata after the fact.

**Scheduled work is backed by the database, not only by the queue.** Redis losing a delayed job must not mean a worker never gets paid. Anything time-triggered, above all the 24-hour auto-approval, stores its deadline in a database column and has a periodic sweeper that catches whatever the queue dropped.

**Every external call is idempotent where it moves money.** Payment operations carry idempotency keys. Webhooks are safe to replay, because gateways do replay them.

**The API is stateless.** No in-memory sessions, no local file storage, no per-instance caches that would make two replicas disagree. Realtime uses the Redis adapter so any instance can serve any socket.

## Forbidden

- Business logic in a controller or a React component
- Direct database access from the web app
- Trusting any client-supplied price, status, or unverified coordinate
- Serializing a database entity straight to a response
- Floating-point currency
- Raw spatial SQL outside the geo repository
- Status writes outside the transitions module
- Synchronous notification fan-out inside a request
- Proxying media uploads through the API
- Exposing phone numbers or email addresses between marketplace parties
