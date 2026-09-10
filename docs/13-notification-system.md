# 13 — Notification System

Notification logic scattered across services is how a marketplace ends up sending four messages for one event, or none. Every notification is declared here and dispatched through one service.

## Channels

| Channel | Use | Availability |
|---|---|---|
| **Web Push** | Time-sensitive, mainly worker-facing | Requires PWA install. Fully available on Android; on iOS only after the user adds the app to the home screen |
| **Email** | Account, payment and record-keeping events | Always |
| **In-app** | Everything, as the durable record | Always |
| **SMS** | Reserved for critical events | Post-MVP, requires Indian DLT registration |

**In-app is the fallback for everything.** Push may be unsubscribed and email may be filtered; the notification centre always holds the record.

## Event matrix

| Event | Recipient | Push | Email | In-app |
|---|---|---|---|---|
| Email verification | User | | ✓ | |
| Phone OTP | User | | | ✓ |
| Password reset | User | | ✓ | |
| KYC approved | Worker | ✓ | ✓ | ✓ |
| KYC rejected | Worker | ✓ | ✓ | ✓ |
| **New task nearby** | Matched workers | ✓ | | ✓ |
| Task published | Requester | | | ✓ |
| **Worker assigned** | Requester | ✓ | ✓ | ✓ |
| Offer expired, another worker accepted | Offered workers | | | ✓ |
| Worker en route | Requester | ✓ | | ✓ |
| Worker arrived | Requester | ✓ | | ✓ |
| **Proof submitted** | Requester | ✓ | ✓ | ✓ |
| Review reminder, 6h before deadline | Requester | ✓ | ✓ | ✓ |
| Task approved | Worker | ✓ | ✓ | ✓ |
| Task auto-approved | Both | ✓ | ✓ | ✓ |
| Task rejected, rework requested | Worker | ✓ | ✓ | ✓ |
| **Payment released** | Worker | ✓ | ✓ | ✓ |
| Payout processed | Worker | ✓ | ✓ | ✓ |
| Payout failed | Worker | ✓ | ✓ | ✓ |
| Payment failed | Requester | ✓ | ✓ | ✓ |
| Task cancelled | Other party | ✓ | ✓ | ✓ |
| Task expired, refund issued | Requester | ✓ | ✓ | ✓ |
| Worker abandoned | Requester | ✓ | ✓ | ✓ |
| Deadline approaching, 2h | Assigned worker | ✓ | | ✓ |
| **New message** | Other party | ✓ | | ✓ |
| Dispute raised | Other party, admin | ✓ | ✓ | ✓ |
| Dispute resolved | Both | ✓ | ✓ | ✓ |
| Rating received | Rated user | | | ✓ |
| Account suspended | User | | ✓ | ✓ |
| High-risk task held for review | Requester | | ✓ | ✓ |

Bolded events are the ones that carry the product. If push must be limited, these are the ones that keep it.

## Rules

**One notification per event per recipient.** Not one per channel per retry.

**Batching.** Multiple nearby-task matches within 10 minutes become one digest. A worker receiving six separate pushes in a minute disables push, and then never receives the one that mattered.

**No failure notifications for losing an offer.** A worker who did not get a task is told in-app, quietly. Pushing "you lost" trains people to dread the notification.

**Chat notifications are suppressed while the recipient is actively viewing that task's chat.**

**Deep links.** Every notification opens the exact screen it concerns, never a generic home screen.

**Dispatch is asynchronous, always.** Notification sending never happens inside a request. It is queued and processed by the worker process, so a slow push service cannot slow the API.

**Failures are logged and retried, never surfaced as request errors.** A failed push must not fail the action that triggered it.

## Preferences

Users control push and email per category: task activity, messages, payments, marketing.

**Cannot be disabled:** payment events, dispute events, account security events. These are records the user needs whether or not they want them.

Every email carries an unsubscribe link for the categories that permit it.

## Web Push

VAPID keys generated at setup, private key held only in server configuration.

`push_subscriptions` stores endpoint (unique), keys and user agent. A subscription rejected as expired by the push service is deleted rather than retried indefinitely.

**Onboarding matters more than the code here.** Push permission is requested at the moment it makes sense, right after a worker sets availability and understands they are waiting for task alerts, never on first page load. iOS workers are shown an explicit add-to-home-screen step, because on iOS push does not work without it.

## Templates

Every template lives in one place, holds a plain-text and an HTML version, and is tested for correct rendering with missing optional fields.

Content rules:

- Never include a phone number or email address of the other party.
- Never include amounts in a push payload beyond the task payout. Push payloads are visible on a lock screen.
- Never include OTP codes, tokens or document numbers in push.
- Currency always formatted from paise through `packages/money`, never hand-formatted per template.
