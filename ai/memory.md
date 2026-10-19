# Project Memory — Decision Log

The running record of what has been decided, why, and what was rejected. Read this before proposing an architectural change, so settled questions are not re-argued from scratch.

Newest entries at the top. Every entry states the decision, the reasoning, and what was considered and turned down.

---

## 2026-10-19 — P5: an "Other" category in the requester's own words, a proof delete button you can hit, searchable state/city for admins, and the phone layout after accepting checked

**Decided.**
- **"Other" is a real category** (`other`, one place, inserted by its migration like pickup & delivery), not a free-text category field on every task. Choosing it asks "What kind of task is it?" (3–60 characters, `tasks.custom_category_label`), and that label is shown wherever the category name would be: the feed, incoming requests, the task page. The server requires the label for "Other" and refuses it on every named category, so a label can never disguise a real category. It is screened with the task text on create, edit and publish. Workers opt into "Other" like any category (onboarding lists it, last). Matching is unchanged: a worker is offered "Other" tasks only if they chose "Other".
- **Why not "Other" with a free-text category everywhere:** categories carry location mode, default proof and matching; a label on a real category keeps all of that while letting the requester say what they mean. Admins can later promote a frequent label to a named category.
- **Searchable dropdowns:** every long list is now a searchable combobox: state and city in the location picker (P1) and, new, the admin's "New city" form (picking a listed city fills its centre). The remaining native selects have five or six options (proof type, document type, release and report reasons, category mode), where a native select is the faster, more accessible control on a phone; they stay.
- **Phone layout after accepting:** re-checked live at 375 px through accept → task page → tabs → chat → "On my way": no horizontal overflow, content clears the tab bar, every control responds. The P2 task-page rebuild is what fixed the reported breakage; nothing further was needed.
- **Proof delete button:** now a full-size, labelled, red "Remove" button on its own line (it had been an icon squeezed to 4 px by a button padding bug, fixed in P3).

---

## 2026-10-19 — P4: identity through DigiLocker (Cashfree Secure ID), bank and UPI accounts checked against that identity, payouts gated on both

**Provider research first, as the founder asked (2026-10-19).**
- **Razorpay** has no public API for verifying an end user's PAN or Aadhaar; its KYC pages are about onboarding merchants (CKYC, DigiLocker for the business owner, video KYC). Its bank check, RazorpayX **Fund Account Validation**, needs a RazorpayX (Lite) account and does not work in test mode. So "the payment gateway does KYC" is not true here, exactly as the founder warned.
- **Cashfree Secure ID** (Verification API) has, documented and with a sandbox: **DigiLocker** (hosted consent link, `POST /digilocker`, status `GET /digilocker`, documents `GET /digilocker/document/AADHAAR`), **bank account verification** (`POST /bank-account/sync`, returns `name_at_bank` and a name-match verdict), and **UPI penny drop** (`POST /upi/penny-drop`, needs recorded consent). It is independent of the payment gateway, so payments stay on Razorpay.
- Not chosen now, but credible: Digio, IDfy, Signzy, HyperVerge (all do DigiLocker/PAN/bank). The provider sits behind an interface (`modules/verification`), so switching is one driver.

**Decided.**
- **Identity = DigiLocker, consent-based.** The worker signs in to DigiLocker and shares Aadhaar; we keep **only the name and the last four digits**, never the number, address, date of birth or photo. A verified identity is **level 2** (docs/12), automatically, with an audit entry and the existing KYC_APPROVED notification. Five attempts per 24 hours, then the manual upload (unchanged, admin-reviewed) is the route. A user can stop at any point; a denial or expiry is shown with a retry.
- **Payout accounts are checked against that identity.** Adding one needs level 2. The provider confirms the account exists and returns the holder's name; it must match the verified name (provider verdict, or our own `compareNames`: same words in any order, or the shorter name contained in the longer with initials allowed). Outcomes: VERIFIED, FAILED (with the bank's reason), NAME_MISMATCH ("payouts can only go to an account in your own name"), or PENDING when the provider could not be reached (never a made-up verdict). The worker consents explicitly to the check, which may send ₹1. The account number is now kept encrypted (for "Check again" and the future payout partner); only the last four digits are ever shown.
- **Restriction of financial features:** payouts are sent only to a VERIFIED default account of a level 2+ worker (`PayoutsService`); earnings stay owed and visible until then. Accepting tasks above ₹1,000 already required level 2.
- **`VERIFICATION_PROVIDER`** = `mock` | `cashfree` | `none`; unset is `none` in production (manual review only; accounts stay unchecked), `mock` elsewhere. `cashfree` needs `CASHFREE_VERIFICATION_CLIENT_ID/SECRET`; `CASHFREE_VERIFICATION_BASE_URL` defaults to the sandbox. The mock's DigiLocker is an in-app page clearly labelled "Test mode"; the API refuses its consent route with any real provider.

**Before switching on Cashfree in production:** a Cashfree merchant account with Secure ID enabled, a DPDP-compliant privacy notice naming the provider, and a data-processing agreement. The driver was written against Cashfree's documentation and tested with a stubbed `fetch`; it has **not** been run against the live sandbox (no credentials here). The first sandbox run should use Cashfree's published test accounts (e.g. 026291800001191 / YESB0000262) and VPAs (success@upi, invalid@upi).

**Rejected.** Collecting Aadhaar numbers ourselves (OKYC via OTP): more data than needed and more liability. Face match/liveness: not needed while identity is DigiLocker-backed; revisit for higher-value tiers. Auto-approving manual uploads with OCR: the manual path stays human.

---

## 2026-10-19 — P3: the requester sets the price, items are bought and settled without commission, commission is hidden, and workers get paid out

**Decided (founder's list, items 9, 12 and 16).**
- **The requester sets the task payment.** Category price ranges are no longer shown anywhere (they stay on the category row for admins). The floor dropped from ₹300 to **₹100** (`MIN_TASK_BUDGET_PAISE`), because the founder's own example is "₹200 to do it"; at ₹100 the 15% still covers the gateway and payout fees, just thinly. docs/02's ₹300 reasoning is kept as the argument for nudging prices up later, not as a hard rule.
- **Buying an item for the requester** (reverses the 2026-09-07 exclusion, confirmed 2026-10-18) is an **item budget on pickup & delivery tasks only**: a bought item needs somewhere to be delivered, so a one-place task refuses one. The requester pays task payment + item budget, captured together in escrow. The worker pays at the shop with their own money, and at submission reports what it cost (never more than the budget) with a receipt photo, which is added as a required proof automatically. On approval the worker is owed earnings + the reported cost, and the unspent budget is refunded. **Commission is taken on the task payment only**; the item money passes through (`packages/money` `calculateItemSettlement`, ledger `WORKER_PAYABLE` reimbursement + `REFUND` lines, balanced and tested). Capped at ₹10,000 (`MAX_ITEM_BUDGET_PAISE`), which is also the most a worker is ever asked to front. Risk score and minimum verification level are computed on everything at stake (task payment + item budget).
- **On a split dispute**, the percentage divides the task payment; the item is reimbursed in full and its unspent budget refunded (a dispute about the item itself is a refund decision instead). A dispute decided for the worker now goes through the same release as an approval, which also fixes a gap: it used to credit the ledger without creating a Payout row, so the worker would never have been sent the money.
- **Commission is never shown to requesters or workers.** The requester's task view has `money: { taskPaymentPaise, itemBudgetPaise, totalPaise, itemSpentPaise, itemRefundPaise }`; the worker's has `payoutPaise` and `item`. Neither has commission or the other side's figure (a worker seeing the gross would derive it). `GET /tasks/mine` now returns one `amountPaise` per perspective; the old `budgetPaise` there leaked the gross price to workers. Admins still see the full split. Asserted in the PII projection test.
- **Payouts.** `PayoutsService` sends what is owed to the worker's verified default bank account or UPI ID: straight after release, then by the worker-process sweep for accounts verified later, failures (backoff 5 / 30 / 60 min, `PAYOUT_MAX_ATTEMPTS`) and transfers stuck in PROCESSING. Each send is claimed with a conditional update first, so two processes never send twice; the `WORKER_PAYABLE → WORKER_SETTLED` ledger entry and the task's `COMPLETED → PAYMENT_RELEASED` step happen only on a confirmed transfer. Workers see what is ready, on the way and paid, earnings apart from item reimbursements, failure reasons, references, and can tap "Pay out". Payout accounts: holder name, 9–18 digit number typed twice, IFSC, PAN (encrypted); only the last four digits are stored; at most 3; removing one keeps it for history.
- **`PAYOUT_PROVIDER`** is `mock` (instant; an account ending 0000 is declined, to exercise failures) or `none` (payouts stay owed and visible). Unset, it is `none` in production, so no deploy breaks for want of it. A real payout partner (RazorpayX Payouts or Razorpay Route linked accounts) and real bank-account verification are P4; until then the mock marks a new account verified at once and `none` leaves it pending.

**Rejected.** Charging a processing fee on the item budget (the gateway's ~2% on it is a real platform cost, but the founder asked for no commission on items; recorded as a business question below). Letting the worker request an advance for the item (that is the cash-handling problem the original exclusion was about). Wallet balances (still a heavier regulatory obligation than escrowing one task).

**Open business questions.** Who bears the gateway fee on the item money; whether ₹100 is the right floor; whether high-value items should require level 3.

**Also fixed.** Icon-only buttons rendered their icon 4 px wide app-wide (a base `px-5` beat the icon size's `px-0` by stylesheet order). This was the "proof delete button is too small" report in the founder's list (P5); padding now lives only in the button sizes.

---

## 2026-10-19 — P2: live task requests with a 90-second countdown, live worker location, and the task page as steps and tabs

**Decided with the founder.** (1) A request goes to a wave of the best few nearby workers at once, each with **90 seconds** to respond (`OFFER_RESPONSE_SECONDS`); first confirmed accept wins; when every request in a wave has been declined, the next wider wave goes out at once, otherwise when the window runs out (the configured 10/15/20-minute tier waits are now only an upper bound). (2) Live location is shared **from "On my way" until arrival**, and for deliveries also **while carrying the item** to the drop-off — not from acceptance, which would often reveal the worker's home. (3) **Latest point only**, in Redis with a 2-minute TTL; no trail is stored. This is the one exception to invariant 6, now written into `ai/project-context.md` and `docs/12`.

**How.**
- `task_offers.expires_at`; `OffersService` (matching module) announces requests, closes everyone else's on accept (`TAKEN`), withdraws them on cancel/expiry, expires overdue ones (tier pass + a sweep every minute in the worker process), and advances the wave early. `GET /offers/mine` is the catch-up read.
- Realtime from the worker process uses **`@socket.io/redis-emitter`** (new dependency, MIT, the official companion to the Redis adapter already in use): the worker process has no socket server, and matching runs there. Every authenticated socket joins `user:{id}`.
- `LiveLocationService` (realtime module) takes `location:update` only from the assigned worker, only while `trackingLeg()` says so, throttled to one per 2 s per task, measures the distance to the current destination with PostGIS, stores the latest point and broadcasts it to the task room. The web app mirrors the rule in `lib/task-progress.ts isTracking`.
- No state-machine change: for a delivery, `ARRIVED` is "at the pickup" and the first proof (the item photo) moves it to `IN_PROGRESS` = "picked up, delivering", which is exactly when the drop-off leg of sharing starts.
- The task page is now a "Now" card with the viewer's next action, the live trip map while sharing is on, and tabs (Progress steps, Details, Payment, Chat on narrow screens). Steps differ by task type (`stepsFor`): a delivery gets "Heading to pickup / At the pickup / Picked up, delivering", an inspection does not.

**Found live, fixed.** A worker process starting up drained queued tier jobs for tasks long past their deadline and put them on workers' screens ("Due in 0 min"). `runTierPass` now does nothing for an overdue task (the expiry sweep refunds it) and `GET /offers/mine` excludes them.

**Limits, stated rather than hidden.** A web app tracks only while the screen is open (no background location on iOS or Android browsers); the worker is told to keep the screen open, and the requester sees "Signal weak" after 45 s without an update. The worker process (`ROLE=worker`) must be running for waves, expiry and the sweeps — locally it is not started by `pnpm dev`.

---

## 2026-10-19 — P1: map-based locations on OpenStreetMap, pickup & delivery as a category mode, and the real cause of "a friend 50 km away saw my task"

**The 50 km bug had two causes, both fixed.** (1) `GET /tasks/nearby` took `latitude`, `longitude` and `radiusMeters` from the query string, so the feed measured from wherever the client said; the server now uses the worker's saved base and `working_radius_m` and the schema no longer has those fields. (2) More likely the actual report: a worker's base was the **centre of a city chosen from a short list** (onboarding offered city buttons only), so a worker living 60 km away who picked the nearest listed city got that city's tasks. Onboarding now sets the base on a map (search, device location, drag), can be edited later (Feed → Change), and the city is only a display label derived from the point. Matching (`findNearbyWorkers`) already honoured each worker's own radius and needed no change.

**Decided.**
- **OpenStreetMap only** (founder, 2026-10-19), replacing the never-implemented "Google for geocoding". Search and reverse geocoding go through the API (`modules/places`) to Photon (no key, fair use, honest User-Agent, 60/min per user, India bbox); `GEOCODING_PROVIDER` is now `osm | mock`, and a stale `google` value is read as `osm` so an old env file cannot stop the API booting. Display is MapLibre GL **5.24** with OSM raster tiles, lazy-loaded as its own chunk (~285 KB gzip) so the main bundle and the feed budget are unaffected. MapLibre 6.x exists; 5.x was chosen for a known API, and upgrading is a separate change.
- **Pickup & delivery is a category mode** (founder choice): `categories.location_mode` is `SINGLE` or `PICKUP_DROPOFF`, and a new `pickup-delivery` category is inserted by the migration itself so production gets it without a seed. The task location stays the pickup point and the only matching input; the drop-off (`dropoff_*` columns, generated `dropoff_geog`, all-or-nothing check constraint) must be inside India, at least 50 m and at most `MAX_DELIVERY_DISTANCE_M` (default 50 km) from the pickup, measured with PostGIS. Whether a drop-off is required or refused is decided by the server from the category, never by the client. The open feed shows only the drop-off locality and trip distance; the exact drop-off is revealed to the assignee (recorded in the PII projection test). Proof GPS on a delivery task counts against the nearer of pickup and drop-off.
- **The picker emits nothing below zoom 14**, so a country- or city-wide view can never become a task or base location; the state → city dropdowns only frame the map.
- PIN codes are dropped from the feed's approximate locality ("Vejalpur Taluka, Gujarat", not "Gujarat, 380015").

**Not done in P1, deliberately:** the execution flow for deliveries (separate "picked up" and "delivered" steps) belongs to P2's task-progress redesign; until then a delivery task runs through the existing inspection flow with its category's three default proofs. OSM's own tile servers are fine for development and light use only; switch `VITE_MAP_TILE_URL` to a tile provider before real traffic.

---

## 2026-10-18 — Founder's feature list: built in priority phases; P0 is moderation, leave/remove, and sessions; three recorded scope decisions reversed

**Context.** The founder sent an 18-item feature and bug list with a priority table (P0 safety and core → P5 polish) and asked for it to be built phase by phase, each phase shown on localhost before anything is pushed. Several items reverse decisions recorded below, so they were raised before building rather than resolved silently.

**Scope decisions the founder confirmed (2026-10-18), reversing "Launch scope stays narrow" (2026-09-07) in part:**
1. **Pickup & delivery tasks are in scope** (a task may have a pickup and a drop-off location, not only one inspection point). To be built in P1.
2. **Workers may buy products on the requester's behalf.** The purchase cost is held and handled separately from the task payment, and commission applies only to the task payment. To be built in P3. Until then the "purchasing on the requester's behalf" hard block in `risk.service.ts` stays as it is.
3. **The requester may see the assigned worker's live location** while the worker is on the way to an active task, with the worker told it's on. This is a deliberate exception to invariant 6 ("they share the task location and in-app chat, nothing else"), and must stay scoped to the active-task window. To be built in P2.
`docs/01`, `docs/17` and `ai/project-context.md` must be updated in the phase that actually builds each of these, not before, so the docs never describe something the code does not do.

**P0 decided and built:**
- **Requester removes the worker: before arrival only** (`ASSIGNED`, `WORKER_EN_ROUTE` → `MATCHING`). No money moves, it is not counted against the worker, at most 3 per task. After arrival, use Report an issue. A new transition rule for actor `REQUESTER` in `transitions.ts`.
- **Worker leaves: any time before submission** (the existing `ACTIVE_WORK → MATCHING` rule, now guarded to the assigned worker). Reason required. Completion rate drops (`tasks_abandoned` +1, rate recomputed), uploaded proof is discarded, the worker can never re-accept that task or be re-offered it (`task_releases` table, checked by accept, the feed query and matching), the requester is notified, and matching restarts from tier 1. Chat for a later worker shows only messages from their own assignment onward.
- **Known consequence, accepted:** remove-then-cancel lets a requester get a full refund after assignment but before arrival. That matches "no compensation before arrival" and leaves the open compensation question (min(₹50, 10%)) for after-arrival cancellation, which is still blocked.
- **Moderation** (`modules/moderation`): rules (now normalised against `k1ll`/`k.i.l.l`/zero-width tricks, with a short benign-phrase list) plus the **OpenAI Moderation API**, which the founder chose over Claude and which only runs when `OPENAI_API_KEY` is set (it fails open). Blocks start a **5-minute posting pause** enforced by the API on create, edit, payment order and publish. Users can appeal; admins uphold or overturn at `/admin/moderation`, and overturning whitelists that exact content for that user. No auto-ban (a policy call left to humans).
- **"Logged out when I come back"** had two causes: (a) the refresh cookie was third-party in production (vercel.app ↔ duckdns.org), which Safari/iOS/strict browsers drop; fixed by proxying `/api/v1/*` through `vercel.json` so the cookie is first-party (sockets still go direct). (b) Two tabs refreshing at once tripped reuse detection and burned the family; fixed by a 30-second grace window for a just-rotated token with a live replacement, plus Web Locks in the client. Theft detection (replay after the window, or a signed-out token) is unchanged and tested.
- Assignment concurrency needed no change: acceptance was already a single conditional `UPDATE`.

**Noticed, not changed (out of P0 scope):** the production API sits behind Caddy with no `trust proxy`, so every request reaches Nest from the same IP and per-IP throttles (login: 5 per 15 minutes) are shared by all users. Needs a deliberate `trust proxy` setting matched to the real hop count.

---

## 2026-10-12 — OWL frontend restyled from the Odoo look to a Rapido/Blinkit-style consumer look

**Decided.** At the owner's request (Swiggy/Rapido feel; match Rapido's and Blinkit's colours; drop the purple), `apps/web-owl` now uses: a bright yellow primary (`#ffcb05`) always paired with near-black text, a green secondary (`#0c831f`) for links, money and success, white rounded cards (12/16/20px radii) on a soft gray page, and Plus Jakarta Sans, self-hosted from `@fontsource-variable` (OFL, listed on /licenses). This replaces the Odoo-style direction recorded under 2026-10-10. Token names are unchanged, so the change is mostly in `globals.css`, `tailwind.config.ts` and `ui/classes.ts`.

- **Yellow is a fill, never text on white** (it fails contrast). Text that must read as brand uses `brand-700`. Buttons on yellow surfaces use the `dark` variant.
- **Progress is amber-orange (`#c25e00`)**, not yellow, so an in-progress status never reads as the brand colour.
- **Navigation:** a white sticky header with section pills on desktop; on phones a bottom tab bar (Home, My tasks, a raised Post button, then Feed/Earnings for workers or Payments/Account otherwise), hidden inside the post-a-task flow, whose Back/Continue bar sticks to the bottom instead. The Odoo apps-grid menu is gone.
- **Motion:** one-shot page fade-in, scroll reveal on the landing page (`hooks/use-reveal.ts`), a pop for selected marks, shimmer skeletons. All honour `prefers-reduced-motion`. The landing headline is deliberately not animated, so it paints immediately.
- **Calm tier still holds:** money breakdowns, evidence, chat, KYC and dispute screens get the new colours but no decoration or extra motion.
- **Fixed in passing:** Tailwind opacity modifiers on token colours (`bg-dispute/10`, used by risk and payout badges) had silently generated nothing; tokens now use `color-mix()` only when a modifier is present, so older browsers keep every solid colour.

**Rejected.** Copying Rapido's or Blinkit's logos, illustrations or wordmarks: only the colour family and layout conventions are borrowed. A Google Fonts link: self-hosting avoids a third-party request on every page view.

---

## 2026-10-10 — The frontend is being rebuilt as a standalone OWL 2 app (`apps/web-owl`, branch `owl-frontend`); `apps/web` stays live until the switch is approved

**Decided.** Replace the Next.js frontend with a standalone OWL 2 app (`@odoo/owl` from npm, used without Odoo), Vite and TypeScript, living beside `apps/web` and talking to the existing API only. Backend, auth, payments, the state machine and every invariant are untouched. `apps/web` is not deleted and the Vercel project is not changed until the owner approves the cutover after a full parity checklist (27 routes) passes.

**Why this form.** A request to "rebuild the UI in Odoo's frontend stack" assumed an Odoo module; this repo has none (no `__manifest__.py`, no Python models). Rewriting the whole product on Odoo was rejected as a re-platform that would discard the API, Razorpay, escrow ledger and matching. The chosen scope keeps only the frontend technology change.

**Consequences accepted.**
- OWL has no Radix equivalent: dialog, select, tabs, toast and switch are hand-built (native `<dialog>`, `<select>`, `role="switch"`). framer-motion becomes CSS transitions. react-hook-form becomes an OWL form helper over the shared zod schemas.
- OWL is client-only, so the landing page loses server-rendered metadata; static meta tags go in `index.html`.
- `apps/web` has no automated tests, so parity is verified screen by screen in a browser against the real API.

**Visual direction: Odoo-style web client, not a pixel copy of `apps/web`.** After the first scaffold looked identical to the old app, the owner asked for an Odoo-like frontend. So `apps/web-owl` uses: a purple navbar (`#714B67`) with an apps-grid menu that doubles as the phone navigation, a user menu, and a per-screen "control panel" (breadcrumbs left, actions right, via `<Page>`); teal (`#017E84`) links; a light gray page with white bordered "sheets"; squarer radii (4/6px). It is done at the token level (`globals.css`, `tailwind.config.ts`, `ui/classes.ts`), keeping the token NAMES so class names still port 1:1. This replaces the earlier warm moss/orange palette and the glass/gradient tiering for the OWL app only; `apps/web` is unchanged. Money and evidence screens stay calm by default under this look. The Odoo name, logo and assets are not used; only the layout conventions are.

**Dev wiring, because the API allows exactly one origin.** `main.ts` calls `enableCors({ origin: [env.WEB_URL] })` and the Socket.IO gateway rejects any handshake whose `Origin` is not `WEB_URL` (`realtime/cors-origin.ts`), so a second origin cannot talk to the API as-is. In dev the Vite proxy forwards `/api` and `/socket.io` and presents the API's own allowed origin, which needs no API change. Production, where the two apps would be on different origins, is a cutover-plan question: either the new app takes over the existing domain or the API needs a multi-origin allow-list. **Decided 2026-10-10: Option A.** The OWL app takes over the existing production domain, so `WEB_URL` is unchanged and the API gets no multi-origin allow-list. Consequence accepted: a Vercel preview URL cannot call the production API, so the first real test of the OWL build against production is the cutover itself, with the old project kept untouched for instant rollback.

**Status.** All 27 routes are ported and each was exercised in a browser against the real local API (auth, dashboard, feed, tasks, wizard, task detail, payments, notifications, settings, KYC, profile, worker onboarding and earnings, the eight admin screens, landing, offline). The PWA is rebuilt (manifest, hand-written service worker with the same never-cache-the-API rule, static `/offline.html`, install banner); the worker's logic is covered by tests that run it against fake `self`/`caches`/`fetch`, because the in-app browser cannot register a service worker. `apps/web-owl/vercel.json` carries the security headers `apps/web` sets in `next.config.mjs` plus the SPA rewrite; it has no effect on the live Vercel project. Not verified: a dispute resolution that succeeds (every open local dispute was already released), the admin "new category" form, real Razorpay checkout (local payments are the mock provider), and real browser service-worker registration. Deliberate differences from `apps/web`: phone navigation is the apps-menu rather than a bottom bar, and the offline fallback is a static page rather than a route. **Cut over 2026-10-12.** The Vercel project `onsite` (the one behind `onsite-orcin.vercel.app`) was repointed at `apps/web-owl` (Vite preset, `vercel.json`, `VITE_API_URL` / `VITE_GOOGLE_CLIENT_ID` / `VITE_VAPID_PUBLIC_KEY`), Production Branch `owl-frontend`. A `*.vercel.app` address belongs to its project, so the Option A "new project takes the domain" idea became "repoint the existing project"; `WEB_URL` and the API are unchanged. Verified on production: static files, security headers, SPA fallback, `sw.js` no-cache, hashed assets immutable, API CORS and the Socket.IO handshake for the production origin, the app booting and the Google button loading. Not yet verified by a person: a real sign-in, a Razorpay test-mode checkout, push opt-in, service-worker install and offline.

**Found while verifying.** The shared packages ship CommonJS `dist`; Vite does not interop linked CJS packages in dev, so `vite.config.ts` and `tsconfig.json` alias `@onsite/*` to their `src` entries (the same thing Next's `transpilePackages` did). Also: OWL schedules renders with `requestAnimationFrame`, which a hidden tab pauses, so a headless or backgrounded browser shows an empty `#app` with no error. That is the environment, not a bug. Two OWL template gotchas, both hit while porting: a plain class method called from an inline arrow in a template (`t-on-click="() => pick(x)"`) runs without `this`, so handlers that use `this` must be arrow-function properties; and a controlled `<input type="number">` must not be rewritten while focused, because Chrome reports "22." as "22" and writing that back drops the dot and moves the caret (`TextField` handles this).

---

## 2026-09-24 — A blocked "kill someone" task now leaves an audit trail; the block itself was also a real gap, found by a direct question rather than code review

**Decided.** Two things, found in sequence:

1. `RiskService.assertNotProhibited` — the hard-block prohibited-content check run at task creation — had **zero patterns for violence against a person**. Weapons, drugs, fraud, impersonation, hacking and the two launch-scope exclusions were all covered; "kill", "murder", "kidnap" were not, despite `docs/12-trust-safety.md` explicitly listing "Anything illegal" and "Anything endangering the worker" as prohibited. A task titled "I need someone to kill my neighbor" would have passed creation cleanly. Fixed by adding a pattern for `kill|murder|assassinate|kidnap|abduct|torture` — words chosen specifically because they have no legitimate use in a physical-task description, unlike "shoot" or "attack" (this app has an actual photography category; "shoot a video" is real, common phrasing that must not trip a hard block).
2. **A blocked attempt recorded nothing.** The client got a `400`-equivalent and that was the entire trace — no audit row, no signal to the platform operator that someone tried this. For a marketplace that dispatches real people to real addresses, "we silently rejected it" isn't the same as "we know it happened." `TasksService` now has an `AuditService` dependency (already `@Global()`, no new module wiring needed) and calls it — via a new `RiskService.findProhibitedMatch`, a non-throwing sibling to `assertNotProhibited` — before rethrowing, recording actor, IP, the matched reason, and the full title/description. `create` and `update` both wired; both routes gained `@Ip()`.

**Why the audit content includes the raw text, not just a flag.** A bare "blocked, reason: violence" row is useless to a human deciding whether to escalate — trust & safety needs to actually read what was written to judge severity and intent (test message vs. a real threat vs. a darkly-phrased legitimate task). The `AuditLog.after` JSON column already exists for exactly this "before/after" shape.

**Considered and deliberately not built.** Auto-banning or auto-notifying-authorities on a match — that is a policy decision (what threshold, what channel, false-positive tolerance) this session was explicitly asked not to make unilaterally; the mechanical piece (the record existing at all, queryable by `action: 'PROHIBITED_TASK_BLOCKED'`) is what was asked for. No admin UI to browse these rows was built either — `AuditLog` has none for any action type yet, and adding one for just this action would be inconsistent scope-creep beyond what was requested.

**Live-verified against the real local database**, not just unit tests: a real authenticated `POST /tasks` with "kill my business rival" in the description returned the expected `422` with the exact reason, and a direct query of `AuditLog` confirmed the row — actor, IP, reason, and the full text — landed correctly.

---

## 2026-09-24 — Task wizard's "Back" silently showed stale numbers after Create task; found live, fixed, and traced to the dev-mode service worker actively hiding the fix

**Decided.** `tasks/new/page.tsx`'s review step caches a server-created `draft` object (set by `createDraft()`, read by `ReviewStep` to decide between "review and create" vs "confirm and pay"). Nothing ever invalidated it. Going Back after "Create task" to edit the budget (or anything else) and returning to Review re-showed the *original* draft's numbers, unchanged — the requester could edit the budget, see the live estimate update correctly on the Details step, then watch it silently revert to the old amount on Review, with no error and no visual difference from a working screen. Fixed in `goToStep`: since `draft` is only ever non-null while on the review step, any call that leaves it with a draft already set (only possible via "Back") now clears `draft` and `submitError` first, so the next visit to Review falls back to the live client-side estimate and requires a fresh "Create task" — a fresh, correct server draft — before paying.

**Found live, by the founder actually using the wizard**, not by code review — exactly the kind of bug (a value silently not updating) that a wizard's own author stops noticing because they habitually complete it top to bottom without backtracking.

**A second, separate bug found while verifying the first one, and arguably the more important find.** The fix did not visibly work on the first several attempts to reproduce it in the browser, even after confirming the file on disk was correct and the dev server had recompiled. Root cause: `PwaInstallBanner` registered `/sw.js` unconditionally, including under `next dev`. The service worker was intercepting navigation and serving a cached app shell — a self-reinforcing loop, since the *cached* bundle contained the *old* `PwaInstallBanner` code, which re-registered the same stale worker on every load. `navigator.serviceWorker.getRegistrations()` confirmed it was active and controlling the page throughout. This is the same failure mode `ai/memory.md`'s Phase 10/11 entries already named as "the root cause of multiple stale-content bugs throughout the session" — it had never actually been fixed at the registration call site, only worked around reactively each time it caused a symptom. Fixed for real this time: registration is now gated on `NODE_ENV === 'production'`, so `next dev` never installs a service worker at all. Production behavior is unchanged. Live-verified: `getRegistrations()` returns zero after the fix, across a genuine reload, and stays at zero on a further unrelated navigation.

**Why this second fix matters beyond this one bug.** Every future session doing local UI work against `next dev` was at risk of the exact same "my fix isn't taking effect" false signal this one produced — costing real debugging time on a phantom problem before the actual, unrelated bug (the stale `draft`) could even be examined. Gating registration at the source removes the whole class of symptom, not just this instance of it.

---

## 2026-09-24 — Lint/CI wiring, structured logging, and the decline endpoint closed out; three TODO.md leftover-work items deliberately left alone

**Decided.** Three genuine gaps from `TODO.md`'s own audit were closed: ESLint/Prettier wiring plus a real CI workflow (Phase 2), structured logging with correlation identifiers via `nestjs-pino` (Phase 10), and `POST /tasks/:id/decline` (Phase 4/9). All three are live-verified, not just written — see each change's own commit/diff for the verification detail (lint clean across all 7 packages, a real HTTP request through the pino correlation-id + redaction pipeline, a real `TaskOffer` row taken through decline → conflict-on-redecline → 404-with-no-offer against the local dev database).

**Decline was smaller than `TODO.md` thought.** The prior audit entry (2026-09-24, admin dashboard work, same day) said decline was "genuinely missing... but unlike the three fixed earlier this one has no backing `TaskDecline` table at all... left deferred." That was wrong: `TaskOffer.response`/`declineReason` have existed in the schema since Phase 1 and were simply never written by any code path (confirmed by grep — zero write sites). No migration was needed; `decline()` just writes those existing columns. Scoped deliberately to workers who were actually offered the task (a `TaskOffer` row must exist) rather than fabricating one for a worker who found the task by browsing the open feed — `TaskOffer`'s rank/score/distance are real matching-engine output ("what makes ranking auditable," per that model's own comment), and inventing plausible-looking values for a browse-decline would quietly corrupt that audit trail. A worker who was never offered has nothing to decline; they simply don't accept, exactly as already worked before this change.

**What was found and fixed along the way, not separately planned.** Wiring ESLint surfaced several real (small) issues, not just style noise: a dead `DEFAULT_GEOFENCE_METERS` import, two service methods keeping an unused fetch result around when only its authorization side effect mattered, a non-null assertion in the matching scorer fixed by narrowing at the point of use instead of asserting past the compiler, and a few cursor-pagination call sites still using `page.at(-1)!` after the rest of the codebase had already moved to `const last = page.at(-1)`. Also found while wiring the dependency-audit CI step: `vitest@2.1.8` carried a real critical advisory (arbitrary file read/execute via its UI server, GHSA-5xrq-8626-4rwp) — bumped to `^3.2.6` since it was genuinely easy and dev-only, unlike the other 14 high-severity findings, which are all transitive (pulled in by pinned majors of `next`/`@nestjs`/`prisma`) and were left alone rather than forcing an unrelated major-version bump under this task's scope.

**Considered and deliberately left alone, with reasons, not silently skipped:**
- **Admin task block** (`POST /admin/tasks/:id/block`) — still has no representable status in `TaskStatus` (no `BLOCKED` state), and what blocking should even mean operationally (can a blocked task still be worked? does it freeze payment? who unblocks it?) is undocumented product design, not a wiring gap. Forcing an enum value in to close a checklist item is exactly the shortcut `ai/task-generation-rules.md` warns against.
- **Notification batching/digests** — needs a real delayed-aggregation job design (batching window, what happens to the immediate-send path it would replace), not a quick wire-up. Left deferred rather than rushed.
- **Payout transfers, email provider (`EMAIL_PROVIDER=console`), Sentry, Google Maps key** — all need a real third-party account/credential this session cannot create on the user's behalf (account creation is explicitly out of bounds regardless of who asks). Flagged to the user rather than attempted or silently dropped.
- **Query-count assertion harness** — no tooling exists for it yet; not started this pass, no partial/half-built version left behind either.

---

## 2026-09-24 — Admin dashboard metrics, admin task detail, and category/city management built

**Decided.** `GET /admin/metrics` — deliberately deferred on 2026-09-10 with the reasoning "a metrics dashboard is a new aggregation feature, not a trust/safety primitive... left as documented gaps rather than built with no consumer" — is now built, along with two features that were never even audited before: a per-task admin detail view (`GET/​page /admin/tasks/:id`), and admin CRUD for categories and cities (`/admin/categories`, `/admin/cities`), toggling the `isActive` flag that `categories.controller.ts`'s own comment always said should be an admin action rather than a manual database edit.

**Why now.** The prior deferral's stated reason was "no consumer yet." There now is one — built at explicit user request after a full route sweep of the live app, not decided ambient to an unrelated task.

**What each one is:**
- Dashboard metrics are plain aggregates over existing columns, nothing new tracked. Definitions pinned down in `admin.service.ts`'s `getDashboardMetrics` comment where docs/15 doesn't specify one (active workers, completion rate, median time to match, acceptance rate).
- Median time to match is computed in application code over a 200-row sample, not `percentile_cont` in Postgres, specifically to avoid raw SQL outside `geo.repository.ts` (ai/architecture-rules.md) for a screen that doesn't need it.
- Task detail mirrors `DisputesService.getEvidenceBundle`'s shape (money, both parties, timeline, evidence) but isn't gated on a `Dispute` row existing — it's the same information oversight already trusted an admin with, just reachable for any task, not only a disputed one.
- Category/city writes are audit-logged like every other admin write (docs/15's "no exceptions"). There is deliberately no delete — matching the existing pattern of deactivation (`isActive`) rather than destructive removal, since `Task.cityId`/`categoryId` are non-nullable foreign keys and deleting either would orphan historical tasks.

**Considered and turned down.** A DELETE endpoint for categories/cities — rejected for the FK-orphaning reason above; `isActive: false` already achieves "stop offering this" without breaking history.

---

## 2026-09-22 — Task location gate widened from Ahmedabad/Kolkata to all of India; worker supply is unaffected and stays where it is

**Decided.** `TasksService.create`/`update` no longer reject a task location outside a seeded city's radius. They now only reject coordinates outside a generous India bounding box (`isWithinIndiaBounds`, `geo.repository.ts` — 6–38°N, 68–98°E, catching obviously-wrong input like `0,0` or a different country, not a precise border check). `GeoRepository.findContainingCity` (reject-if-outside) was replaced with `findNearestCity` (always attach the closest active city, for display only — "near Lucknow" — never as a gate). The seed data grew from two cities to 49, at least one per state/UT, purely so that label has something sensible to attach to. The frontend task wizard's copy and the state/city picker changed to match.

**Why.** The founding two-city pairing was originally chosen to bound *worker recruitment*, not to bound *where a requester is allowed to point a task*. Those are two different constraints that had been conflated into one code gate. Matching was already keyed entirely off task-location-to-worker-location geo-distance (`findNearbyWorkers`/`findNearbyTasks` in `geo.repository.ts`) and never joined on `cityId` — so removing the city gate changes nothing about who can be matched to what; it only changes whether a requester outside the two founding cities is allowed to try. A task posted somewhere with no nearby verified workers already had a documented, honest outcome before this change: the matching tiers find nobody, and the task expires and refunds at its deadline (`matching.service.ts`'s own comment: "This signals a supply gap; the task will expire and refund"). Widening the geographic gate does not introduce a new failure mode, it just lets that existing, already-safe fallback be reached from more places.

**What did NOT change, and matters more than what did.** Worker recruitment, verification and actual coverage remain concentrated in Ahmedabad and Kolkata — nothing about worker onboarding, KYC, or the launch category list moved. `docs/17-mvp-scope.md`'s "twenty workers recruited and verified in Kolkata" launch-readiness item is unaffected. A requester in, say, Guwahati can now technically post a task, but should expect it to expire unaccepted until real supply exists there. This is a change to what the software *permits*, not a claim that the business is pan-India-ready.

**Rejected.** Leaving the two-city gate in code while treating the "real" scope decision as a business/docs-only matter — rejected because `docs/`, `ai/project-context.md` invariant 8, and this file's own prior entry ("Launch scope stays narrow," below) all treated the geographic gate as settled, and `ai/task-generation-rules.md` is explicit that widening launch scope must never happen silently in code. This entry, and the accompanying updates to `CLAUDE.md`, `ai/project-context.md`, `docs/01-product-requirements.md` and `docs/17-mvp-scope.md`, exist specifically so this change is recorded rather than discovered later as an unexplained drift between code and spec — it was found exactly that way, as uncommitted working-tree changes with no matching doc or memory update, during an unrelated logic-and-fallback audit of the repository.

**Trigger to revisit.** If real-world abuse, fraud, or worker-safety incidents show up specifically from far-flung, low-supply locations, the bounding box can be tightened back toward a city allow-list without touching the matching engine at all, since matching never depended on the city gate in the first place.

---

## 2026-09-07 — Build sequence: specs before code

**Decided.** Write the complete `docs/` and `ai/` specification layer before writing application code.

**Why.** This is the founder document's own strongest recommendation and it is correct. When architecture and business logic are invented at the same time as the code, every session re-decides the data model and the rules drift. The specification layer is what makes later work consistent.

**Rejected.** Scaffolding the monorepo first and documenting afterwards. Documentation written after code describes what happened rather than governing it.

---

## 2026-09-07 — Product name: OnSite

**Decided.** The product is **OnSite**.

**Why.** It states the positioning directly: someone on the ground, wherever you need them. It works for the consumer pitch and survives the later move to business customers.

**Rejected.** Setu, meaning bridge, which was distinctive but needed explaining. OnGround, which was clear but flatter. Bharosa, meaning trust, which was emotionally strong for consumers but awkward for enterprise sales.

---

## 2026-09-07 — Client architecture: one web codebase, installable as a PWA

**Decided.** A single Next.js application serves the marketing site, the requester app, the worker app and the admin console. It is installable as a PWA with Web Push. No native mobile app for now.

**Why.** One codebase reaches production far faster than two, and needs no app store review to ship a fix. On Android, roughly 95% of the Indian market, install, push, camera and geolocation all work.

**Known cost, accepted.** On iOS, push requires the user to add the app to the home screen, and there is no background geolocation or background sync. This is tolerable because the design captures GPS at discrete moments, arrival and proof submission, rather than tracking workers continuously. Worker onboarding includes an explicit iOS install step.

**Trigger to revisit.** iOS becoming a meaningful share of active workers, or a genuine need for background location.

**Constraint this creates.** `packages/types`, `packages/validation`, `packages/money` and `packages/utils` must stay free of Node built-ins and DOM assumptions, so a React Native app can consume them later. Cheap now, expensive to retrofit.

---

## 2026-09-07 — ORM: Prisma, with PostGIS quarantined

**Decided.** Prisma for the whole schema. All spatial SQL confined to `apps/api/src/repositories/geo.repository.ts` behind typed wrappers.

**Why.** Verified as of September 2026: Prisma still has no native geography type, and PostGIS columns map to `Unsupported`. Spatial queries must use `$queryRaw`. That is an acceptable cost because spatial queries are a small, well-bounded part of the system, while Prisma's migrations, relations and Studio benefit the other 95%. Studio also substitutes for the missing local `psql` client.

**Rejected.** Drizzle, which handles raw SQL more naturally but has weaker migration tooling. TypeORM, which has a PostGIS extension but worse day-to-day ergonomics. Neither advantage outweighed quarantining perhaps a dozen spatial queries.

**Non-negotiable.** Raw spatial SQL outside the geo repository is a defect.

---

## 2026-09-07 — The sweeper caught a real bug in the queue it exists to back up

Built the 24-hour auto-approval as two independent paths, deliberately: a BullMQ delayed job (the fast path, Redis-backed) and a `setInterval` sweeper polling `tasks.review_deadline_at` directly in Postgres (the guarantee, no Redis dependency at all). The design reasoning, worth restating: if the sweeper itself depended on BullMQ or Redis, a Redis outage would take down both the fast path and the mechanism meant to catch the fast path's failure. A plain timer against the database cannot be taken down by a queue outage.

**This paid off immediately.** The first live submission through the fast path failed to schedule with `Custom Id cannot contain :` — BullMQ rejects a colon in a custom job id, and the scheduler used `auto-approve:<taskId>`. `AutoApproveQueue.schedule` is written to swallow scheduling failures rather than let them fail the submission (a queue hiccup must never block a worker from submitting proof), so the task submitted successfully and only logged a warning: "the sweeper will still catch it at its deadline." It would have. Fixed by using `auto-approve--<taskId>` instead.

The lesson isn't just the specific bug — it's that the resilience design was proven by an actual failure on the first real run, not merely asserted in a comment. A system that degrades to its documented fallback the first time something breaks, rather than failing the user-facing operation, is doing exactly what it was built to do.

---

## 2026-09-07 — A fifth trap: `import type` on a constructor parameter breaks Nest dependency injection

`ledger.service.ts` had `constructor(private readonly prisma: PrismaClient) {}` with `PrismaClient` brought in via `import type { ... PrismaClient } from '@prisma/client'`. It compiled cleanly and looked identical to `geo.repository.ts`'s working equivalent, but failed at boot with `Nest can't resolve dependencies of the LedgerService (?)`.

The reason: Nest resolves constructor injection from TypeScript's `design:paramtypes` decorator metadata, which is only emitted for a type the compiler can see referenced as a **value** at runtime. `import type` erases the import entirely from the compiled output, so the emitted metadata for that parameter degrades to `Object`, and Nest has nothing to look up a provider by. `geo.repository.ts` uses a plain value import of `PrismaClient` and has never had this problem.

**Rule going forward:** any class-typed constructor parameter that Nest must inject requires a value import of that class, never `import type`, even where only the type is referenced in the source. This is now the second decorator-metadata trap in this codebase (the first being esbuild/tsx losing the same metadata entirely) — both point at the same lesson: Nest's DI is metadata-dependent in ways that compile without complaint and fail only at runtime, so a fresh boot-and-hit-every-route check after adding a new injectable is cheap insurance.

---

## 2026-09-07 — A fourth trap: method-level `@UsePipes()` validates every parameter, including custom decorators

Found while building Phase 3 auth: `@UsePipes(zodPipe(schema))` at the **method** level in NestJS applies that pipe to every resolved parameter of the handler, not just `@Body()`. On any handler combining `@Body()` with a custom parameter decorator such as `@CurrentUser()`, the pipe also ran against the `CurrentUser` object, tried to validate it against the body schema, and failed with `"fieldName": "Required"` on every field — a confusing symptom that looks like the request body never arrived, when the body was fine and the wrong value was being validated.

`@Res()` and `@Req()` are unaffected (Nest excludes the platform request/response objects from pipe application), which is why `register` and `login` worked while `workers.create`, `users.updateMe`, `users.submitKyc`, `users.addPayoutAccount`, and `auth.sendPhoneOtp` / `verifyPhoneOtp` all broke — every one of those combines `@Body()` with `@CurrentUser()`.

**Fix, applied everywhere this pattern occurs:** bind the pipe to the parameter, not the method — `@Body(zodPipe(schema)) body: T` instead of `@UsePipes(zodPipe(schema))` above the handler. Method-level `@UsePipes()` is safe only when the handler has no custom parameter decorators.

Caught by live end-to-end testing rather than unit tests, because a unit test calling the service directly never exercises Nest's parameter-resolution pipeline. Worth remembering: controller-level wiring bugs like this one are invisible to service-level tests and need at least one real HTTP round trip per route shape.

---

## 2026-09-07 — Three build and runtime traps, each of which failed silently

Recorded because all three produce misleading symptoms and cost real time.

**Never run the API with tsx, or any esbuild-based runner.** Nest resolves constructor injection from the `design:paramtypes` metadata that TypeScript's `emitDecoratorMetadata` emits. esbuild does not implement it. Under tsx the application boots perfectly, logs every module as initialised, then fails on the first request with `Cannot read properties of undefined (reading 'isHealthy')`, because every injected dependency is `undefined`. Use `pnpm dev`, which runs the Nest CLI, or build and run `node dist/main.js`. The seed script is fine under tsx: it is a plain script with no decorators.

**`incremental` had to be turned off for the API build.** The Nest CLI deletes `outDir` before compiling, but a surviving `tsconfig.tsbuildinfo` left tsc believing the project was already built, so it emitted nothing at all and the server started against an empty `dist` with `MODULE_NOT_FOUND`. `tsconfig.build.json` sets `incremental: false` and also `noEmitOnError: true`, so a type error can never again surface as a confusing runtime module error.

**Prisma maps `String @id` to Postgres `text`, not `uuid`.** Casting an id to `::uuid` in raw SQL therefore fails with `operator does not exist: text = uuid`. All casts in the geo repository are `::text` and `::text[]`. Native `@db.Uuid` columns would be more compact and index marginally better; at this scale that is immaterial and not worth the migration. Revisit only if row counts reach the millions.

**Also worth keeping:** in raw SQL prefer `= ANY(${array}::text[])` over an `IN` list built with `Prisma.join`. It takes one parameter instead of many, needs no empty-array special case, and puts the cast on the array rather than on each element.

---

## 2026-09-07 — PostGIS columns are database-generated, and declared to Prisma

**Decided.** Every `geography(Point, 4326)` column is a `GENERATED ALWAYS AS (...) STORED` column derived from the latitude and longitude that Prisma writes, and each is declared in `schema.prisma` as `Unsupported(...)` with a matching `@default(dbgenerated(...))`. The two GIST indexes are declared with `@@index(..., type: Gist)`.

**Why generated.** The geography can then never drift from the coordinates it comes from. No code path can set one without the other, including a raw SQL insert or a manual fix in psql. Verified: the column refuses direct writes, and updating latitude or longitude moves it automatically.

**Why the declarations matter, and this was not optional.** Without them, `prisma migrate diff` reported drift and a future `prisma migrate dev` would have quietly dropped the generated expressions and both GIST indexes. That failure would have been invisible until matching slowed down in production. With the declarations, drift is clean at exit code 0.

**Also learned.** Prisma ignores partial indexes entirely, so `tasks_open_feed_ix`, `tasks_review_deadline_ix`, `tasks_expiry_ix` and `payouts_stuck_ix` live only in the hand-written migration and are safe from the differ.

**Rejected.** Triggers, which would also have been invisible to Prisma but are more machinery and can be bypassed by a badly written migration. Also rejected: abandoning `migrate dev` for hand-written migrations only, which would have worked but made every future schema change laborious.

---

## 2026-09-07 — The application uses its own database, not the container's default

**Decided.** The Postgres container's `POSTGRES_DB` is `onsite`; the application connects to `onsite_app`, created from `template0` by a compose init script.

**Why.** The `postgis/postgis` image preinstalls postgis, postgis_topology, fuzzystrmatch and postgis_tiger_geocoder into whatever `POSTGRES_DB` names. Prisma treats any extension it did not create as drift and refuses to migrate, and the only remedy it offers is a destructive reset. A database built from `template0` carries no extensions, so Prisma creates and owns exactly one, postgis, which is also all that production needs.

---

## 2026-09-07 — Payments: Razorpay Route, and a regulatory constraint on the business

**Decided.** Razorpay Route, behind a payment provider interface with a mock driver for local development.

**Why.** Reserve Bank of India rules do not permit a marketplace to hold customer money in an ordinary current account. Pooling funds between a paying requester and a worker awaiting payout requires a nodal or escrow arrangement. Route is built for this: capture the full amount, hold it against the platform, transfer the worker's share on approval, retain the commission.

**Rejected.** Plain Razorpay Checkout plus manual bank transfers, which would put pooled customer funds in a normal account. That is a compliance problem, not a shortcut.

**Blocking dependency, and it is paperwork not engineering.** Real money movement needs a business entity, Razorpay KYC and Route activation. The full escrow flow can be built and tested end to end in test mode without any of it.

---

## 2026-09-07 — Maps: Google for geocoding, OpenStreetMap for display

**Decided.** Google Places Autocomplete and Geocoding for turning addresses into coordinates. MapLibre over OpenStreetMap tiles for rendering maps. Both behind a geocoding interface.

**Why.** Address accuracy is where this product breaks if it is wrong, and Google Places is the most reliable way to resolve a messy Indian address to an exact point. Google's India-billed Essentials tier includes 70,000 free events per month, ample at launch. Map display, however, is a solved problem that does not need paid tiles, so rendering on OpenStreetMap keeps the Google quota reserved for the calls where accuracy matters.

**Rejected.** Mappls, which has genuinely better rural and Tier 2 or 3 coverage, but whose pricing is sales-gated and starts near $300 per month. Wrong economics at launch. The interface exists so Mappls can be swapped in when coverage outside metros becomes the constraint.

---

## 2026-09-07 — Money representation: integer paise, double-entry ledger

**Decided.** All currency is integer paise. Every movement writes balanced double-entry ledger rows, and a task's entries must sum to zero.

**Why.** Floating-point currency eventually loses money and the loss is hard to find. A ledger that must balance turns a whole class of bugs into a failing assertion instead of a slow discrepancy nobody notices until a worker complains.

---

## 2026-09-07 — Scheduled work is backed by the database, not only the queue

**Decided.** Anything time-triggered, above all the 24-hour auto-approval, stores its deadline in a database column and is caught by a periodic sweeper in addition to its BullMQ delayed job.

**Why.** If Redis drops a delayed job, the queue-only design means a worker silently never gets paid. That failure is invisible until someone complains, which is the worst kind. The sweeper makes the database the source of truth and the queue merely the fast path.

---

## 2026-09-07 — Scale target: 1,000+ concurrent users, deliberately unexotic

**Decided.** Design for 1,000+ concurrent users by avoiding a specific short list of mistakes: media proxied through the API, chat by polling, connection pool exhaustion, unindexed spatial queries, and synchronous notification fan-out. Explicitly out of scope: sharding, read replicas, multi-region.

**Why.** 1,000 concurrent users is a modest load for this stack. The work is not exotic engineering, it is not making the standard errors. Building for hypothetical scale now would cost time the product needs elsewhere.

---

## 2026-09-07 — Launch scope stays narrow

**Decided.** Launch with remote inspection and verification only, in Ahmedabad and Kolkata only.

**Why.** "Anything, anywhere" invites fraud, prohibited tasks, worker safety incidents and unpriceable work, all before the marketplace has enough liquidity to survive them. A narrow category is controllable and makes the trust problem tractable.

**Consequence.** Proposals to widen scope belong in `docs/18-future-roadmap.md`, not in the codebase.

---

## 2026-09-07 — A delayed job that reschedules its own successor cannot reuse its own job id

Built the matching engine's radius expansion (docs/10) as a BullMQ job per tier: tier N's processor, on finishing, schedules tier N+1. The first version gave the job a single id per *task* (`match-tier--<taskId>`), following the same "one job, rescheduled" pattern as the auto-approve queue's `schedule()`.

**This broke on the very first live run, silently.** Tier 1 fired correctly, offered ten workers, and logged its success. Tier 2 never fired. No error, no warning — the job simply vanished. The cause: scheduling tier 2 happens *from inside* tier 1's own processor, while tier 1 is still the currently-executing job holding that job id. `queue.add()` with the same id created a new delayed job under the same Redis key tier 1 occupied. The instant tier 1's handler returned, BullMQ's `removeOnComplete: true` deleted that key — which by then held tier 2's data, not tier 1's. A job cannot safely replace itself mid-execution the way an external caller can cancel-and-reschedule a job that is merely sitting idle.

**Fixed** by giving each `(taskId, tierIndex)` pair its own job id, so a tier's processor never touches the Redis key it is currently running under. `cancelPending` (called on acceptance and expiry) no longer has "the one id" to remove; instead it sweeps every plausible tier index for that task, which is cheap and idempotent since removing a job that was never scheduled is a no-op.

**The general lesson**: `AutoApproveQueue`'s cancel-and-reschedule pattern is safe specifically because the caller rescheduling it (approve/reject) is never the job itself — the job is idle, waiting, when that happens. A job that reschedules its *own next step* from inside its own handler is a different shape of problem and needs a distinct id per step. Live verification caught this in minutes; a mocked unit test of the scheduler alone would not have, since the collision only exists against BullMQ's real completion/removal semantics.

---

## 2026-09-07 — A CORS `origin` callback that never calls its callback hangs the entire handshake, silently, forever

Built the realtime gateway's CORS policy to mirror the REST API's exactly — an explicit origin allow-list, never a wildcard with credentials, per docs/16-security-requirements.md. The first version passed `cors: { origin: () => true, credentials: true }` to `@WebSocketGateway`.

**Every single WebSocket connection attempt against the real running server hung forever.** Not an error, not a timeout, not a log line — `curl` against `/socket.io/?EIO=4&transport=polling` simply never got a response, while every ordinary REST endpoint on the same server answered instantly. That asymmetry was the first real clue: whatever was wrong was specific to the socket.io path, not the server as a whole.

**The cause.** The `cors` npm package Engine.IO uses underneath supports an `origin` option shaped as a function, but that function must be `(origin, callback)` and must call `callback(err, allow)` — it is not a plain predicate whose return value is read. A zero-argument function that returns `true` gets invoked as `originFn(requestOrigin, callback)`; it ignores both arguments, returns a value nobody looks at, and never calls `callback`. The CORS middleware then waits forever for a decision that will never come, and the entire handshake — which happens before any application code, including this gateway's own `handleConnection` auth check — hangs with it. No unit test caught this, because none of them exercise Engine.IO's actual CORS negotiation; a hang has no assertion to fail against, only a request that never returns.

**A second symptom, same root cause.** A client connecting with `transports: ['websocket']` (skipping the polling handshake) instead crashed the whole API process outright: `Unhandled 'error' event ... ECONNRESET`. The client eventually gave up on the stuck handshake and reset the connection; something in that abandoned-connection path threw on a raw socket with no listener for it. Fixing the callback bug fixed both symptoms — confirmed by deliberately reproducing the websocket-only crash again afterward and watching the process survive.

**Fixed** by extracting the actual allow/deny decision into `isAllowedOrigin(origin, webUrl)` — a pure, tested function — and wiring the gateway's `origin` option to call `callback(null, isAllowedOrigin(origin, loadEnv().WEB_URL))`. The isolation process along the way matters as much as the fix: swapping the custom Redis-backed `IoAdapter` for the stock one first, to rule out the adapter before suspecting the CORS config, is what actually found the real cause instead of stopping at a plausible-looking one.

**The general lesson**: a hang is a different failure mode from an error, and needs a different diagnostic instinct — check what DOES respond (an ordinary REST route, in this case) before assuming the whole server is broken, and treat any framework option documented as "a function" with real suspicion about its exact calling convention rather than assuming a natural-looking implementation is a compatible one.

---

## 2026-09-07 — Reading a status and later writing it is not the same as guarding the write

Built dispute freezing (docs/14) on top of the existing task-approval path (`ReviewService.completeApproval`, Phase 6). The first version's logic read as reasonable: check `assertTransitionAllowed(task.status, 'COMPLETED', ..., { hasOpenDispute: false })` against the task snapshot already in hand, and if that passed, release payment and write `COMPLETED`. `hasOpenDispute` was hardcoded `false` back in Phase 6 with a comment marking it as "the one line that changes when disputes are built" — so building disputes meant making that flag real.

**The instinct to fix it by querying for an open dispute and passing the real boolean would have been wrong**, and worth recording exactly why. That query reads the database at some moment before the write. A dispute raised in the gap between that read and the `COMPLETED` write — which is exactly what docs/14 means by "a dispute raised one second before the 24-hour auto-approval deadline must win that race" — would not be seen by the check, and the plain `update()` that followed would silently overwrite the dispute's `DISPUTED` status with `COMPLETED`, releasing payment on a task someone had just disputed.

**Fixed** by making the status write itself the guard, the same pattern `TasksService.accept()` already used for the double-acceptance race: `prisma.task.updateMany({ where: { id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, data: { status: 'COMPLETED', ... } })`. Postgres serializes concurrent writes to one row; whichever transaction commits first — the dispute's own atomic freeze, or this release — wins, and the other's `updateMany` affects zero rows. `completeApproval` now checks that count and returns `{ acted: false }` rather than proceeding to release payment. `reject()` and `DisputesService.raise()` got the identical treatment.

**The general lesson, worth restating because it is easy to re-learn the hard way**: a read-then-conditionally-write pattern is a TOCTOU race no matter how correct the condition looks, whenever the write that follows is not itself conditioned on the state the read observed. The fix is never "read more carefully" or "read closer to the write" — it is to make the database enforce the condition atomically as part of the write. This is the same principle `accept()`'s comment already stated for the double-acceptance race; disputes are the second time this codebase needed it, and probably not the last.

**Verified live, not just in a fake-Prisma unit test**: fired a real HTTP `POST /tasks/:id/dispute` and a real HTTP `POST /tasks/:id/approve` at the same SUBMITTED task with `Promise.all` — genuinely concurrent requests, real auth, real database. Exactly one succeeded (the dispute); the other came back a clean `422 ILLEGAL_TASK_TRANSITION`; the payment stayed `CAPTURED`. See TODO.md's Phase 9 entry for the full verification, including the subsequent admin resolution and ledger balance check.

---

## 2026-09-07 — A tight limit on two dimensions at once throttles innocent traffic, not abuse

Built `docs/16-security-requirements.md`'s "applied per IP and per account, whichever binds first" as two independently-tracked throttler dimensions on top of `@nestjs/throttler`'s default (`default`, IP-based): `account` (keyed by the email/phone in an unauthenticated request's body, for login/register/password-reset/OTP) and `user` (keyed by the `sub` claim decoded — never verified — from an authenticated request's bearer token, for task creation, accept, payment creation, messages). The second copy of AUTH_THROTTLE-style routes tightened BOTH `default` and the new dimension to the identical number, on the reasoning that more limits can only mean more safety.

**That reasoning is backwards, and load-testing the accept-herd scenario from docs/20 caught it on the first run.** Fifty real, distinct workers accepting the same task — the exact scenario the whole atomic-`updateMany` design exists to make safe — all originate from one IP in any test harness (and, in the real world, from one shared IP behind a mobile carrier's CGNAT or an office network, which is common in India specifically). Tightening `default` to the same 30-per-minute figure as the new per-worker `user` dimension meant the fiftieth-and-onward request in a single burst got blocked by the IP bucket, regardless of the fact that each of the fifty distinct workers was individually nowhere near its own limit. Fifty legitimate people racing for one task is not the failure mode a rate limit exists to stop; it's the marketplace working.

**Fixed** by only tightening the dimension the spec actually names for each route (`user` for task creation/accept/payments/messages, both `account` and `default` for the genuinely IP-relevant login-family routes) and leaving the other dimension at the module's generous baseline. The general lesson: a rate limit's job is to bound one specific actor's or one specific line's abuse, and stacking the identical tight number onto every dimension a request happens to have doesn't add safety — it just finds the first legitimate traffic pattern that touches more than one of those dimensions at once and blocks it.

**A second, purely mechanical finding along the way**: `@nestjs/throttler`'s `ThrottlerGuard.canActivate` only ever iterates throttler names already declared in the module-level `ThrottlerModule.forRoot({ throttlers: [...] })` array — a route's `@Throttle({ user: {...} })` can override an existing name's limit, but cannot introduce `user` as a name the guard will ever check if it isn't already registered there. Discovered by watching `throttle:user:*` keys simply never appear in Redis despite the route-level config looking correct; fixed by registering `account` and `user` at the module level too, with deliberately enormous default limits so routes that never override them are effectively unthrottled on those dimensions.

Verified live twice: once by inspecting the actual Redis keys created after a real request (confirming both dimensions are tracked as genuinely separate counters), and again by re-running the accept-herd test after each fix — the first fix alone still failed for reasons the second fix explained, and only both together produced clean runs.

---

## 2026-09-07 — A Docker multi-stage build generates the Prisma client before it has a schema to read

Wrote `apps/api/Dockerfile` as a standard three-stage build: install dependencies (cached across source-only changes, so only `package.json` files are copied into that stage), then copy real source and compile, then copy only the compiled output into a slim runtime image.

**Building it — not just writing it — surfaced 76 TypeScript errors** in the compile stage that looked like they had nothing to do with each other: implicit `any` on nearly every Prisma query result's callback parameter, `Property 'sql' does not exist on type 'typeof Prisma'`, `Module has no exported member 'User'`. None of those are real problems with the application code, which typechecks and builds cleanly outside Docker.

**The cause**: `pnpm install` in the dependency stage triggers `@prisma/client`'s own postinstall, which runs `prisma generate`. At that point in the build, only `package.json` files exist in the image — deliberately, so that layer stays cached when only application source changes, not dependencies. `prisma/schema.prisma` isn't copied in until the next stage. `prisma generate` running with no schema to read produces an empty, typeless stub client, and that stub — not the real one — is what's sitting in `node_modules` when `nest build` runs moments later in the same image.

**Fixed** by explicitly running `prisma generate` again, after the real schema is copied in and before `nest build`, rather than trusting the implicit postinstall generate from the earlier stage. The general lesson, the same shape as several others in this file: a dependency's own install-time side effect can silently produce a plausible-but-wrong artifact when it runs before the input it needs exists, and the failure it causes downstream looks nothing like its actual cause — the fix was found by building the image for real and reading the compiler's confusion literally, not by reasoning about the Dockerfile in the abstract.

---

## 2026-09-10 — `pnpm dev` runs package.json scripts through `cmd.exe` on Windows, not the invoking shell

`apps/web/package.json`'s `dev` and `start` scripts read `next dev -p ${WEB_PORT:-3000}` — ordinary bash default-value substitution, and it matched the convention `apps/api` already used for its own port. Running it via `pnpm --filter @onsite/web dev`, even from inside a bash session, failed: Next.js's CLI rejected `${WEB_PORT:-3000}` as a literal, invalid port number.

**The cause**: pnpm executes `package.json` scripts using the OS's default shell, not the shell that invoked `pnpm` — on Windows that's `cmd.exe` regardless of whether the surrounding terminal is bash. `cmd.exe` has no `${VAR:-default}` syntax, so the string was never expanded; it was passed to `-p` verbatim.

**Fixed** by dropping the flag entirely rather than reaching for a shell-abstraction dependency (`cross-env` and friends only solve *setting* a variable portably, not *conditional defaulting*): `next dev --help` confirms `-p`/`--port` already falls back to reading the standard `PORT` env var when omitted, which needs no shell parsing at all. `.env.example` renamed `WEB_PORT` to `PORT` to match. The general lesson: a `package.json` script that looks like ordinary shell is only portable if every developer's (and every CI runner's, and every container's) default shell agrees on the syntax — prefer whatever the tool itself reads natively over shell substitution, when the tool supports it.

---

## 2026-09-10 — A Socket.IO broadcast computed a per-viewer field once, then sent the same object to every viewer

`ChatService.send` builds a `ChatMessageView` via `toView(message, senderId)` — which sets `isMine: message.senderId === currentUserId` — and then hands that ONE object to `RealtimeGateway.emitNewMessage`, which does `this.server.to(roomFor(taskId)).emit('message:new', message)`. `server.to(room).emit` sends the identical payload to every socket in the room. There is no per-socket customization in a plain room broadcast.

The bug: `isMine` is a per-viewer fact (only the actual sender should see `true`), but it was baked into the payload once, from the sender's perspective, before the fan-out. Every other party in the room — anyone who didn't send the message — received a payload that still claimed `isMine: true`.

**Found by running two real Socket.IO client connections against the running server** (one authenticated as the requester, one as the worker, both joined to the same task room), having one send a message over the REST endpoint, and reading what each socket actually received — not by reading the gateway code, which reads as correct in isolation (`toView` itself is right; the bug is only that its output gets reused for a broadcast it wasn't computed for). The initial REST fetch (`GET /tasks/:id/messages`, which calls `toView(m, currentUserId)` once per viewer, per request) does NOT have this bug — only the live socket path, because that's the only place one `isMine` value is computed and then handed to multiple recipients.

**Fixed on the client** (`apps/web/src/app/(app)/tasks/[id]/chat-panel.tsx`) rather than the gateway: the live handler recomputes `isMine` itself from the actually-logged-in user's id (`message.senderId === user?.id`) instead of trusting the field on a real-time payload. A proper server-side fix would need per-socket emission (e.g. `socket.to(room).except(senderSocketIds).emit(...)` with a separately-computed payload for the sender), which is real work belonging to whoever next touches `RealtimeGateway` — noted here rather than done as a drive-by change to Phase 8 code during a UI-focused phase. The general lesson, the same shape as several others in this file: a value that is correct where it's computed can still be wrong wherever it's reused, if the reuse crosses a boundary (one viewer's fact broadcast to many viewers) the original computation didn't account for.

---

## 2026-09-10 — Two endpoints promised in docs/07 since Phase 6 were never actually built

Building the payment-history and worker-earnings screens for the web app, `GET /payments/mine` and `GET /payouts/mine` — both listed in `docs/07-api-specification.md`'s own tables since it was written — turned out not to exist anywhere in `apps/api/src`. Confirmed with a grep across the whole API source, not assumed from the docs going stale. Only `POST /payments/orders` and `GET /payments/:taskId` were ever implemented; the underlying `Payment` and `Payout` Prisma models already had everything needed to serve a list, they just had no route reading them back.

**Added them**, which is a deliberate, one-time exception to this phase's own rule of building UI only against the API surface that already exists: the two screens the design spec calls for (docs/19: "Requester: ... history", "Worker: ... earnings") are not buildable at all without a list to read, mocking one up client-side would mean inventing data, and the endpoints themselves are small, read-only, cursor-paginated, and follow the exact projection pattern already used by `TasksService.listMine` and `ChatService.list` — low risk, not a scope expansion in any way that invents new behavior. `payouts/mine` needed its own controller (`payouts.controller.ts`) since payouts live under a `/payouts` prefix in the spec, separate from `/payments`.

**Live-verified** against the real completed task from the lifecycle-completion test: `payments/mine` returned the RELEASED ₹500 payment, `payouts/mine` returned the PENDING ₹425 payout — the same numbers that test produced, read back through routes that didn't exist an hour earlier. The general lesson: a spec file being complete and detailed does not guarantee every endpoint it lists was actually built — this project's own docs/07 had been treated as ground truth all session, and it was still wrong about what existed.

**The same gap shape recurred immediately after, on KYC.** `POST /users/me/kyc` has always existed and assumes `documentFrontKey`/`selfieKey` already sit in storage, but there was never a presign route to get a file into storage for KYC in the first place — `StorageService` only had `presignTaskProofUpload`, hard-scoped to task proofs. Added `presignKycDocumentUpload` plus `POST /users/me/kyc/presign` the same way, and it live-verified the same way: a real image uploaded straight to MinIO, submission accepted, status flipped from `NONE` to `PENDING`.

**And a third time, on the trust badge.** `@onsite/types` has defined a `PublicWorker` interface (rating, rating count, tasks completed, completion rate) since Phase 1's spec-writing pass, but `GET /users/:id/public` only ever returned plain `PublicUser` — grepped the whole API source and `PublicWorker`/`toPublicWorker` appeared nowhere at all, not even in a test. Fixed the same shape of way: added `toPublicWorker` to `common/projections.ts`, had `getPublicProfile` return it when the target has a worker profile. This one also got a proper PII snapshot test it had never had (`common/projections.test.ts`), since `toPublicUser`/`toSelfUser` are among the most-reused projections in the codebase and had somehow never been asserted on directly.

Three for three now on "a type or a route the docs/shared-package/DB schema all assume exists, but nobody wrote the last piece connecting them" — confidently a pattern, not a coincidence. The common shape: Phase 1's specification layer and the shared `@onsite/types`/`@onsite/validation` packages were written completely and correctly ahead of the backend phases, and later backend work correctly consumed the parts it needed for its own phase's scope — but nothing ever swept back to check that every type and every documented route actually got a corresponding implementation. Worth checking directly (grep for a type name, or for a documented path) rather than assuming "the spec says so" ever again in this project.

**A fourth instance turned up immediately after, building the admin dispute evidence viewer.** `DisputesService.getEvidenceBundle` already assembled every proof's metadata (type, distance, verification flags) but never had a `StorageService` to generate a viewing URL from a proof's `storageKey` — the bundle described the evidence without ever making it reachable. Fixed the same way as the KYC queue's existing pattern (`AdminService.listKycQueue` already presigned KYC documents): added `StorageService` to `DisputesModule` and `DisputesService`, presigned each proof. Four for four now — and this fourth one is the most useful data point yet, because it shows the pattern isn't confined to routes and shared-package types: **a service quietly missing a dependency it needs** is the same shape of gap, just one level more specific. After this many hits, a real endpoint-and-dependency audit (comparing every `docs/07` route against `apps/api/src/modules/**/*.controller.ts`, plus checking which services touch storage/media without importing `StorageService`) was run as a background task — see the entry below for its findings and what was and wasn't fixed as a result.

## 2026-09-10 — Endpoint audit: what docs/07 promises vs what's actually built

A background audit compared every route documented in `docs/07-api-specification.md` against `apps/api/src/modules/**/*.controller.ts`, prompted by having found four of the same "spec says X exists, it doesn't" gap by accident in one session. Roughly 65 documented routes match an implemented controller method 1:1. The gaps, and the decision on each:

- **`POST /auth/google`** — missing, `googleAuthSchema` unused. Correctly deferred: same honesty standard as always, not built without real Google credentials to test against.
- **`POST /payments/webhook`** — missing. Correctly deferred: no real Razorpay integration exists (mock provider only), so there is nothing to verify a webhook signature against yet.
- **`POST /tasks/:id/decline`** — genuinely missing, `declineTaskSchema` unused, but unlike the four fixed gaps above, **there is no `TaskDecline` table at all**. This would need a new Prisma model and migration, not a route connecting pieces that already exist — real feature work, not a connector fix. Left deferred rather than added on the side during a UI-focused phase. A worker can currently only decline implicitly, by not accepting.
- **`GET /tasks/:id/history`** — missing as a dedicated route, but the data (status transition history) is already returned inline by `GET /tasks/:id` and is exactly what the task detail page's timeline renders from. Deliberately not adding a second endpoint for data already exposed.
- **`GET /tasks/price-hint`** — missing entirely, no logic anywhere in the repo. This is real feature design (what should the estimate be based on — category averages? city? both?), not a wiring gap. Deferred; the category's `suggestedMinPaise`/`suggestedMaxPaise` range (already shown in the task wizard) covers the same user need in the meantime.
- **`POST /admin/tasks/:id/block`, `GET /admin/payments`, `POST /admin/payouts/:id/retry`, `GET /admin/metrics`** — all missing. `admin.service.ts`'s own top comment already named these as deliberately out of scope for Phase 9 (no `BLOCKED` task status exists to represent a block; no real payout gateway to retry against; a metrics dashboard is a new aggregation feature, not a trust/safety primitive). Left as documented gaps rather than built with no consumer — the admin console UI was built against every route that does exist.
- A handful of unused shared types (`TaskFeedItem`, `Paginated<T>`, `TrustProfile`, `TaskProof`, `Coordinates`/`GeoPoint`, a few enum aliases) are ordinary type-hygiene drift: the real endpoints work correctly, they just hand-roll an inline response shape instead of importing the matching shared type. Not a missing-feature signal, not touched.

The dividing line worth remembering: fix the gap immediately when it's a **pure connector** — a route, a projection branch, or an injected dependency that would just wire already-existing data through to a screen that needs it (four of these fixed this session, each small and low-risk). Leave it deferred, documented, when closing it would mean **new feature design** — a new table, new business logic, or a feature with no consumer yet. The first kind is cheap to get wrong by omission; the second kind deserves its own real design pass, not a drive-by decision made while building an unrelated screen.

---

## 2026-09-10 — Dark mode's design tokens were only ever partially redefined, and nothing caught it until Lighthouse actually rendered the page

Phase 1's `globals.css` defines five `--ink-*` tokens on the light `:root` (900/700/500/400/300) and documents, in its own comment, that dark mode redefines the *whole* palette so neither theme is ever missing a value. In practice, both dark blocks (the `prefers-color-scheme` media query and the `[data-theme="dark"]` override) only ever redefined `--ink-900` and `--ink-500`. `--ink-700`, `--ink-400`, and `--ink-300` were silently falling back to their light-mode values in dark mode the entire time this session built UI against them — dozens of components, across every phase of the web build, none of which caught it, because typechecking, `next build`, and manual light-mode-default browsing all have no way to notice a CSS custom property that resolves but is simply the wrong shade.

**Only a real Lighthouse run against the actual rendered page caught it** — its color-contrast audit measured `--ink-700` (used by the shared `Label` component, i.e. every form field label in the app) at **1.09:1** against a dark background, and `--ink-400`/`--ink-300` at 3.79:1, both far under the 4.5:1 AA minimum. This is the same shape of lesson as the chat `isMine` broadcast bug earlier in this session — a value that looks obviously fine by inspection (`--ink-700: #1c2230` reads as "a normal dark gray," nothing alarms a code reviewer) is only provably fine or broken once measured against the actual context it renders in.

Fixed by giving all three tokens real dark-mode values, computed (not eyeballed) to clear 4.5:1 with margin against both dark paper tokens. Separately, `--brand-600` turned out to be carrying two incompatible jobs under one token — legible as *text* on a dark background (needs a lighter dark-mode value, which it already had) and legible as a solid *button fill* under white text (needs a darker value, which it didn't have, measuring 3.75:1) — split into `--brand-600` (kept, text/link role) and a new `--brand-solid` (never redefined for dark, since `#2b4fd8` already clears 6.5:1 with white in both themes).

**The general lesson for this project specifically**: a design-token system with light/dark pairs needs every single token checked in both modes at least once with a real contrast tool before being trusted, not just "the ones that seemed likely to matter" — the two tokens missed here (`ink-700`, used for form labels; `ink-400`/`ink-300`, used for the vast majority of captions and secondary text in the app) were arguably the *most*-used tokens in the whole system, not edge cases. If this project ever changes its color tokens again, re-run Lighthouse's color-contrast audit against both themes before considering the change done — "it typechecks and the light mode looks right" said nothing true about dark mode this time.

---

## 2026-09-10 — The founder provided real Razorpay test credentials; the deferred payment integration is now built and live-verified against Razorpay's real sandbox

Every prior phase of this project deliberately stopped short of building the real Razorpay integration, on the same honesty principle applied to Google sign-in: don't fake something that needs real third-party credentials to actually verify. That changed this session — real test-mode Key ID and Key Secret were provided with explicit instruction to use them for testing.

**What got built**: `razorpay.service.ts` (order creation, HMAC-SHA256 webhook signature verification via `timingSafeEqual`), `PaymentsService.createOrder`'s Razorpay branch (creates a real order, does NOT capture — only the webhook can), and `POST /payments/webhook` end to end. The `WebhookEvent` Prisma model already existed, unique `eventId` and all, complete with a comment about replay safety — but had never been wired to a controller. **This is the fifth instance this session of the same shape of gap**: something the schema/types/docs clearly anticipated, sitting unused until a screen or a feature that actually needed it got built. The running tally across this project: `payments/mine` + `payouts/mine` (missing routes), the KYC document presign route (missing route), `PublicWorker` (unused type), the dispute evidence bundle's missing `StorageService` (a service missing a dependency it needed), and now the entire `WebhookEvent` model (an unused table). Five for five is well past coincidence — this project's specification-first phase was thorough, and every phase after it correctly built only what its own scope needed, but nothing ever came back to check that every promise made by the schema and the docs got kept.

**Live-verified against Razorpay's actual API, not simulated**: created a real order and confirmed it independently by querying `api.razorpay.com` directly with basic auth — a real order sitting in Razorpay's sandbox, receipt correctly set to the task id. Then proved the webhook path completely by hand-crafting a `payment.captured` payload, HMAC-signing it with the real webhook secret, and POSTing it to the local endpoint: correctly-signed → captured, ledger balanced, exactly once; replayed → accepted idempotently with zero additional rows; forged signature → rejected `422`, but still recorded as an audit row rather than silently dropped. This is the same "prove it against the real thing" discipline that has run through the whole project, just now with a real external system on the other end instead of only the project's own database.

**What's still honestly not built**: real payout transfers to workers. Razorpay Route needs each worker to have a "Linked Account" (its own KYC-gated onboarding on Razorpay's side) before a Transfer API call can move money to them — that's a real, separate feature with its own scope, not a few more lines next to order capture. `Payout` rows still just record what's owed, same as before.

**A process note worth keeping**: the user pasted real API secrets directly into the chat. The right response was to write them straight into `apps/api/.env` (gitignored, confirmed before this session's earlier commit) rather than have them sit in chat history any longer than necessary, and to say so plainly rather than silently accept them as if it were unremarkable. Also worth remembering: `.env` file changes are NOT picked up by `nest --watch`'s file watcher (it only watches compiled TypeScript sources) — a full process restart is required after editing `.env`, and forgetting this cost a few minutes of confusion mid-session testing against what turned out to be stale env values.

---

## 2026-09-10 — Google sign-in built once real OAuth credentials were provided, and a leaking-500 bug caught by testing the rejection path

Same story as Razorpay, same day: Google sign-in stayed on the "not built without real credentials" list through every prior phase, and came off it the moment the founder provided a real OAuth client id and secret. Built `POST /auth/google`, `GoogleAuthService` (verifies the ID token against Google's actual public keys via `google-auth-library` — signature, expiry, issuer, and audience match against this app's own client id), `AuthService.loginWithGoogle`'s three-way account resolution (existing Google-linked account, link-onto-existing-email-account, or brand new passwordless account), and a `GoogleSignInButton` using Google's own rendered button on the frontend.

**The founder pasted the OAuth client's redirect URI as a screenshot before sending the real values**, and it was configured for Claude's own MCP callback (`https://claude.ai/api/mcp/auth_callback`) — from setting up an unrelated Google connector in Claude's own settings, not from anything to do with this app. Flagged it plainly rather than silently reusing a misconfigured client. The founder's call was to add `http://localhost:3000` to that same client's Authorized JavaScript origins rather than create a dedicated one — a reasonable simplification, since the ID-token sign-in flow this app uses only reads Authorized JavaScript origins and never touches the redirect URI at all, so the stray Claude callback sitting there is inert for OnSite's purposes.

**Live-verified the part that actually matters — rejection, not the happy path.** A full click-through (real consent screen, real Google account) needs a real browser, which isn't available here — same honest limit as every other UI flow this session. What IS provably testable without one: does the verification actually reject a forgery? Sent a malformed token (wrong segment count) and a well-formed-but-unsigned JWT carrying entirely plausible claims — right audience, right issuer, a believable payload — and both were rejected. The second case matters more: it proves the code is genuinely checking the cryptographic signature against Google's live keys, not just validating shape or claims that anyone could fabricate.

**That same test caught a real bug**: the malformed-token case came back as a generic `500 INTERNAL_ERROR`, not a clean `401`. `google-auth-library` throws a bare `Error` on any verification failure and nothing was catching it, so `DomainExceptionFilter` treated it as an unhandled exception. Fixed by catching it in `GoogleAuthService` and re-throwing this codebase's own `UnauthenticatedError` (logging the real cause server-side, never exposing library internals to the client). The general lesson, same shape as several entries above: testing the failure path isn't a formality once real external verification is involved — this bug was invisible until an actual malformed input was thrown at the actual verification call, because nothing about the code read as wrong in isolation.

---

## 2026-09-16 — First real deployment: frontend on Vercel, backend on Oracle Cloud Always Free, proven with a real cross-service write, not just health checks

The founder had no money for hosting, so this had to be genuinely free, not "free trial." Frontend went to Vercel (`https://onsite-orcin.vercel.app`) using a real Vercel API token — the only real snag there was monorepo-shaped: deploying from `apps/web` in isolation uploads only that subdirectory, which breaks `workspace:*` resolution because plain `npm install` doesn't understand pnpm's workspace protocol. Fixed by setting the Vercel project's `rootDirectory` to `apps/web` via the REST API and deploying from the true repo root instead, so Vercel's build sees `pnpm-workspace.yaml` and runs `pnpm install` correctly.

**The backend hit a real capacity wall.** Oracle's free Ampere `VM.Standard.A1.Flex` shape — the one with enough RAM to self-host Postgres+Redis+MinIO — returned "out of capacity" in every availability domain, on every retry, across both requested sizes. This is a known, common Oracle Free Tier condition, not a configuration mistake. Fell back to `VM.Standard.E2.1.Micro` (AMD, always available, but only 1 OCPU/1GB RAM), which forced a real architecture change: **Postgres, Redis, and object storage moved off the box entirely** onto free managed services — Neon (Postgres+PostGIS), Upstash (Redis over TLS), Cloudflare R2 (S3-compatible). Only the API container runs on the instance itself. A 4GB swap file was added before attempting the Docker build, since building this monorepo's API image (pnpm install + prisma generate + nest build, all inside one multi-stage build) would very likely OOM on 1GB of real RAM otherwise — it didn't, but it took close to 7 minutes on the single OCPU, which swap made survivable rather than fast.

**Proof, not assertion, at every layer**: SSH connectivity confirmed by actually connecting before touching anything else; the local `iptables` chain was found default-configured to reject everything but port 22 (a second, separate firewall from Oracle's network-level Security Lists, easy to miss if only the console-level rule is opened); after opening both, `prisma migrate deploy` was run for real against the live Neon database and all three existing migrations applied cleanly; the container was started and `/health/ready` was curled from an outside machine (not from inside the instance) and returned `{"status":"ready","checks":{"database":true}}`; finally, after pointing Vercel's `NEXT_PUBLIC_API_URL` at the real backend IP and redeploying, `POST /auth/register` was called with the Vercel origin in the request and returned a real created user — proving the CORS configuration and the live Neon write path work together, not just each in isolation.

**Two operational details worth remembering for next time this instance is touched**: (1) the SSH private key Oracle generates is shown exactly once and never stored server-side — if the download is missed, the only recovery is a fresh instance, not a re-download; (2) this session's sandbox has a standing guard against starting a throwaway listening service just to probe connectivity (blocked an attempt to spin up `python3 -m http.server` purely as a reachability test) — the correct move when that happens is to verify connectivity through the real service being deployed instead of a synthetic one, not to look for a workaround.

**What's still honestly not done, deliberately left on the TODO list rather than silently glossed over**: `EMAIL_PROVIDER=console` in the deployed environment, meaning verification emails print to Docker logs rather than sending — since email verification gates all real use of the app, no outside user can actually complete signup on this live deployment yet, only whoever can read the container logs. A reverse proxy with real TLS in front of the raw `http://` backend is also still missing. Both are one more round of real third-party setup away, same pattern as everything else this project has treated honestly all along.

---

## Open questions for the founder

Recorded here so they are not forgotten. None block current work.

1. **Business entity registration.** Determines whether real payouts and DLT-registered SMS are weeks or months away, and therefore whether a manual payout bridge is a short stopgap or the plan for the year.
2. **Cancellation and refund policy.** A proposed starting point is compensating the worker `min(₹50, 10% of budget)` when a requester cancels after assignment. This is a business decision, and it needs to appear in the business model doc and the legal pages.
3. **Concierge pilot before launch.** The founder document recommends manually brokering the first tasks over WhatsApp to test willingness to pay before relying on the platform. Strongly worth doing, and it would reorder the build phases.
4. **Domain name.** Needed for DNS, the email sender identity and the legal pages.
