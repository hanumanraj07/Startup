# 06 — Database Design

PostgreSQL 16 with PostGIS. This file is the schema contract. Changing a table means changing this file first.

## Conventions

- Tables and columns are `snake_case`. Primary keys are UUID v7 named `id`.
- All timestamps are `timestamptz` stored in UTC. Timezone conversion happens at display.
- **All currency is `bigint` in paise.** Never a float, never rupees. Column names end in `_paise`.
- Distances are metres, columns end in `_m`.
- Spatial columns are `geography(Point, 4326)` and end in `_geog`. Latitude and longitude are stored alongside for display only and are never used for proximity arithmetic.
- Soft deletion is not used. Lifecycle is expressed by status columns.

## Entity map

```
users
 ├── worker_profiles            (1:1, only for users who work)
 ├── kyc_submissions            (1:n)
 ├── payout_accounts            (1:n)
 ├── refresh_tokens             (1:n)
 ├── push_subscriptions         (1:n)
 └── notifications              (1:n)

tasks
 ├── task_status_history        (1:n)
 ├── task_offers                (1:n — who was matched and notified)
 ├── arrival_records            (1:n)
 ├── task_proofs                (1:n)
 ├── messages                   (1:n)
 ├── payments                   (1:1)
 ├── payouts                    (1:1 after release)
 ├── ledger_entries             (1:n — must sum to zero)
 ├── reviews                    (2 max)
 └── disputes                   (1:n, normally 0 or 1)
       └── dispute_statements   (1:n)
```

## users

The identity record. Contains private data that must never cross the marketplace boundary.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `email` | citext | Unique |
| `email_verified_at` | timestamptz | |
| `phone` | text | Unique, nullable, E.164 |
| `phone_verified_at` | timestamptz | |
| `password_hash` | text | Nullable for OAuth-only accounts. Argon2id |
| `google_id` | text | Unique, nullable |
| `display_name` | text | **Public** |
| `avatar_url` | text | **Public** |
| `home_city` | text | **Public** at city granularity only |
| `home_address` | text | **Private.** Never leaves the server |
| `home_geog` | geography(Point,4326) | **Private.** The requester location. Never used for matching |
| `home_lat`, `home_lng` | double precision | Private, display convenience |
| `verification_level` | smallint | 0 to 5, default 0 |
| `platform_role` | enum | `USER`, `ADMIN` |
| `status` | enum | `ACTIVE`, `SUSPENDED`, `BANNED` |
| `suspended_reason` | text | |
| `created_at`, `updated_at` | timestamptz | |

`home_geog` exists for future convenience features. **It is never an input to matching.** Matching uses the task location.

Public projection: `id`, `display_name`, `avatar_url`, `home_city`, `verification_level`, `created_at`. Nothing else, ever.

## worker_profiles

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK users, unique |
| `base_geog` | geography(Point,4326) | **The matching input.** GIST indexed |
| `base_lat`, `base_lng` | double precision | Display only |
| `base_city` | text | Public |
| `working_radius_m` | integer | Default 10000 |
| `is_available` | boolean | Default false |
| `rating_avg` | numeric(3,2) | |
| `rating_count` | integer | |
| `tasks_offered` | integer | Denominator for response rate |
| `tasks_accepted` | integer | |
| `tasks_completed` | integer | |
| `tasks_abandoned` | integer | |
| `completion_rate` | numeric(5,2) | Maintained on completion |
| `response_rate` | numeric(5,2) | Maintained on offer resolution |
| `last_active_at` | timestamptz | |
| `created_at`, `updated_at` | timestamptz | |

`worker_categories` joins `worker_profiles` to `categories` many-to-many.

Public projection: display name, avatar, city, rating, completion rate, tasks completed, verification level, member since. **Never** `base_geog`, coordinates, or address.

## categories

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `slug` | text | Unique. `product-inspection`, `shop-verification`, `property-inspection`, `document-collection`, `local-photography`, `local-research` |
| `name`, `description`, `icon` | text | |
| `default_proof_requirements` | jsonb | Preset checklist for the category |
| `suggested_min_paise`, `suggested_max_paise` | bigint | Drives the price hint |
| `is_active` | boolean | Only active categories can be selected |

## cities

Enforces the launch scope in data rather than in scattered conditionals.

| Column | Type | Notes |
|---|---|---|
| `id`, `name`, `state` | | Ahmedabad and Kolkata at launch |
| `center_geog` | geography(Point,4326) | |
| `radius_m` | integer | Task locations must fall inside an active city |
| `is_active` | boolean | |

## tasks

The core entity. **Two locations, and they are not interchangeable.**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `requester_id` | uuid | FK users |
| `category_id` | uuid | FK categories |
| `title`, `description` | text | Instructions, including what not to do |
| `status` | enum | See `docs/09-task-lifecycle.md` |
| `task_geog` | geography(Point,4326) | **Where the work happens. The matching input.** GIST indexed |
| `task_lat`, `task_lng` | double precision | Display only |
| `task_address`, `task_place_name` | text | Shown to the assigned worker |
| `task_place_id` | text | Google Place identifier |
| `city_id` | uuid | FK cities |
| `requester_geog` | geography(Point,4326) | **Private.** Snapshot of where the requester was. Never exposed, never matched on |
| `budget_paise` | bigint | |
| `commission_rate_bps` | integer | Basis points, 1500 = 15%. Stored per task so historical rates survive a pricing change |
| `commission_paise` | bigint | Computed at creation and stored |
| `worker_payout_paise` | bigint | Computed at creation and stored |
| `deadline_at` | timestamptz | |
| `proof_requirements` | jsonb | Resolved from the category, adjustable |
| `min_verification_level` | smallint | Derived from budget, enforced at acceptance |
| `risk_level` | enum | `LOW`, `MEDIUM`, `HIGH` |
| `risk_flags` | text[] | Why it was scored that way |
| `assigned_worker_id` | uuid | FK users, nullable |
| `assigned_at` | timestamptz | |
| `current_radius_m` | integer | Matching expansion state |
| `published_at`, `submitted_at`, `completed_at`, `cancelled_at` | timestamptz | |
| `review_deadline_at` | timestamptz | **`submitted_at + 24h`. The auto-approval deadline the sweeper reads** |
| `cancellation_reason` | text | |
| `created_at`, `updated_at` | timestamptz | |

Worker projection excludes `requester_geog`, and the joined requester's email, phone, `home_address` and `home_geog`. Asserted by test over the whole response body.

## task_status_history

Append-only. Written by `transitions.ts` on every status change, and read as dispute evidence.

`id`, `task_id`, `from_status`, `to_status`, `actor_user_id`, `actor_role`, `reason`, `metadata jsonb`, `created_at`

## task_offers

Which workers were matched, ranked, notified, and what they did. This is what makes response rate measurable rather than guessed.

`id`, `task_id`, `worker_id`, `rank`, `score numeric(6,2)`, `distance_m`, `radius_tier_m`, `notified_at`, `viewed_at`, `responded_at`, `response enum(ACCEPTED, DECLINED, EXPIRED)`, `decline_reason`

Unique on `(task_id, worker_id)`.

## arrival_records

`id`, `task_id`, `worker_id`, `reported_geog`, `reported_lat`, `reported_lng`, `distance_from_task_m numeric`, `is_within_geofence boolean`, `accuracy_m`, `created_at`

`distance_from_task_m` is **computed server-side with PostGIS**. The client never supplies a distance and is never believed about one.

## task_proofs

| Column | Type | Notes |
|---|---|---|
| `id`, `task_id`, `worker_id` | uuid | |
| `type` | enum | `PHOTO`, `VIDEO`, `NOTE`, `STRUCTURED_FIELD`, `SIGNATURE` |
| `storage_key` | text | Object storage key. **Never a public URL.** Access is by short-lived presigned GET |
| `mime_type`, `size_bytes` | | Validated server-side against the key |
| `reported_geog` | geography(Point,4326) | Where the client claims capture happened |
| `distance_from_task_m` | numeric | **Server-computed** |
| `verification_flags` | text[] | `gps_outside_geofence`, `timestamp_implausible`, `missing_exif`, `uploaded_long_after_capture` |
| `captured_at` | timestamptz | Client claim |
| `uploaded_at` | timestamptz | Server fact |
| `field_key`, `field_value` | text | For structured proof: price, serial number, availability |
| `note_body` | text | |
| `created_at` | timestamptz | |

Flags never silently block a submission. They are surfaced to the requester and included in the dispute bundle. A shop's mapped pin is frequently wrong by 50 metres and punishing a worker for the map's error would be unjust.

## messages

`id`, `task_id`, `sender_id`, `body`, `redacted_body`, `redaction_flags text[]`, `attachment_key`, `created_at`, `read_at`

`redacted_body` is what is delivered. Phone numbers, email addresses and UPI identifiers are stripped server-side, because moving the transaction off-platform removes every protection both sides have.

## payments

The requester-side charge.

`id`, `task_id`, `requester_id`, `gateway enum(RAZORPAY, MOCK)`, `gateway_order_id`, `gateway_payment_id`, `amount_paise`, `status enum(CREATED, AUTHORIZED, CAPTURED, HELD, RELEASED, REFUNDED, PARTIALLY_REFUNDED, FAILED)`, `idempotency_key` (unique), `failure_reason`, `captured_at`, `released_at`, `refunded_at`, `refund_amount_paise`, `created_at`, `updated_at`

## payouts

The worker-side transfer.

`id`, `task_id`, `worker_id`, `payout_account_id`, `amount_paise`, `status enum(PENDING, PROCESSING, PROCESSED, FAILED, REVERSED)`, `gateway_transfer_id`, `idempotency_key` (unique), `failure_reason`, `attempts`, `processed_at`, `created_at`, `updated_at`

## ledger_entries

Double entry. **The sum of `amount_paise` for any `task_id` must be exactly zero.** Asserted in tests and by a periodic reconciliation job.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `task_id`, `payment_id`, `payout_id` | uuid | Nullable references |
| `account` | enum | `REQUESTER_FUNDS`, `ESCROW`, `PLATFORM_COMMISSION`, `WORKER_PAYABLE`, `GATEWAY_FEE`, `GST_PAYABLE`, `TCS_PAYABLE`, `TDS_PAYABLE`, `REFUND` |
| `entry_type` | enum | `CAPTURE`, `COMMISSION`, `RELEASE`, `REFUND`, `PAYOUT`, `FEE`, `TAX` |
| `amount_paise` | bigint | **Signed.** Debits negative, credits positive |
| `description` | text | |
| `created_at` | timestamptz | Append-only. Corrections are new entries, never updates |

Statutory deduction accounts exist from day one with rates configured at zero, so that adding GST, TCS and TDS later is configuration rather than a schema migration during a tax deadline.

## webhook_events

Gateways replay. This makes replay safe.

`id`, `gateway`, `event_id` (**unique**), `event_type`, `payload jsonb`, `signature_verified boolean`, `processed_at`, `processing_error`, `created_at`

Processing is: insert on the unique `event_id`, and if it conflicts, the event was already handled and is acknowledged without reprocessing.

## reviews

`id`, `task_id`, `rater_id`, `ratee_id`, `direction enum(REQUESTER_TO_WORKER, WORKER_TO_REQUESTER)`, `rating smallint` (1 to 5), `comment`, `created_at`

Unique on `(task_id, rater_id)`.

## disputes

`id`, `task_id`, `raised_by_id`, `reason enum`, `description`, `status enum(OPEN, UNDER_REVIEW, RESOLVED, WITHDRAWN)`, `resolution enum(RELEASE_TO_WORKER, REFUND_TO_REQUESTER, SPLIT)`, `split_worker_paise`, `split_refund_paise`, `resolved_by_admin_id`, `resolution_notes`, `resolved_at`, `created_at`

`dispute_statements`: `id`, `dispute_id`, `user_id`, `body`, `attachment_keys text[]`, `created_at`

## Supporting tables

| Table | Purpose |
|---|---|
| `kyc_submissions` | Document type, encrypted document number, storage keys for front, back and selfie, review status, reviewing admin, rejection reason |
| `payout_accounts` | Bank or UPI, encrypted PAN, gateway contact and fund account identifiers, verification state. **Never store a full account number in plaintext** |
| `refresh_tokens` | Token hash, family identifier for rotation-reuse detection, expiry, revocation, user agent, IP |
| `otp_codes` | Hashed code, channel, purpose, expiry, attempt count, consumption |
| `push_subscriptions` | Endpoint (unique), keys, user agent |
| `notifications` | Type, title, body, data, channels, read state |
| `reports` | Safety and abuse reports |
| `audit_logs` | Actor, IP, action, entity, before and after. Written for every security-sensitive action |

## Indexes

Only the ones that matter. Each exists for a named query.

```sql
-- Spatial. Without these the product does not work at scale.
CREATE INDEX tasks_task_geog_gix ON tasks USING GIST (task_geog);
CREATE INDEX worker_profiles_base_geog_gix ON worker_profiles USING GIST (base_geog);

-- The worker feed: only open tasks are ever scanned.
CREATE INDEX tasks_open_feed_ix ON tasks (deadline_at)
  WHERE status IN ('PUBLISHED','MATCHING') AND assigned_worker_id IS NULL;

-- The auto-approval sweeper.
CREATE INDEX tasks_review_deadline_ix ON tasks (review_deadline_at)
  WHERE status = 'SUBMITTED';

-- Expiry sweeper.
CREATE INDEX tasks_deadline_ix ON tasks (deadline_at)
  WHERE status IN ('PUBLISHED','MATCHING');

CREATE INDEX tasks_requester_ix        ON tasks (requester_id, created_at DESC);
CREATE INDEX tasks_assigned_worker_ix  ON tasks (assigned_worker_id, status);
CREATE INDEX messages_task_ix          ON messages (task_id, created_at);
CREATE INDEX ledger_task_ix            ON ledger_entries (task_id);
CREATE INDEX offers_worker_ix          ON task_offers (worker_id, notified_at DESC);
CREATE UNIQUE INDEX offers_task_worker_uix ON task_offers (task_id, worker_id);
```

## The three queries that matter

**Nearby workers for a task.** Note the two radius conditions: the task's current search radius, and the worker's own declared working radius. A worker who will not travel 12 km should not be offered a task 12 km away.

```sql
SELECT wp.user_id,
       ST_Distance(wp.base_geog, $1::geography) AS distance_m
FROM worker_profiles wp
JOIN users u ON u.id = wp.user_id
WHERE wp.is_available = true
  AND u.status = 'ACTIVE'
  AND u.verification_level >= $2
  AND ST_DWithin(wp.base_geog, $1::geography, $3)
  AND ST_DWithin(wp.base_geog, $1::geography, wp.working_radius_m)
ORDER BY distance_m
LIMIT $4;
```

**Nearby tasks for a worker's feed.**

```sql
SELECT t.id,
       ST_Distance(t.task_geog, $1::geography) AS distance_m
FROM tasks t
WHERE t.status IN ('PUBLISHED','MATCHING')
  AND t.assigned_worker_id IS NULL
  AND t.deadline_at > now()
  AND t.min_verification_level <= $2
  AND ST_DWithin(t.task_geog, $1::geography, $3)
ORDER BY distance_m
LIMIT $4 OFFSET $5;
```

**Accepting a task without a race.** A single atomic conditional update. No advisory locks, no `SELECT FOR UPDATE`, no application-level check-then-act.

```sql
UPDATE tasks
SET status = 'ASSIGNED',
    assigned_worker_id = $1,
    assigned_at = now()
WHERE id = $2
  AND status IN ('PUBLISHED','MATCHING')
  AND assigned_worker_id IS NULL
RETURNING id;
```

Zero rows returned means another worker won. That is a `409`, not an error state, and the interface says so plainly. This is verified under concurrent load: fifty simultaneous accepts must produce exactly one success and forty-nine clean conflicts.

## Migrations

Prisma owns the schema, with three things in hand-written SQL because Prisma cannot express them:

1. `CREATE EXTENSION IF NOT EXISTS postgis;`
2. The `geography(Point, 4326)` columns, declared `Unsupported(...)` in the Prisma schema.
3. The GIST and partial indexes.

Seed data creates the six categories, the two launch cities, an admin account, and demo requesters and workers positioned at known distances around a Kolkata task location so the geo query can be verified against arithmetic rather than hope.
