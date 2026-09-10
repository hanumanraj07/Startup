# 19 — UI Design System

## The design problem

Someone is sending money to a stranger to act on their behalf in a city they cannot reach. The interface has to make that feel accountable rather than reckless.

That leads to three principles, and they decide most arguments:

1. **Evidence over assertion.** Never "task completed". Show the photograph, the measured distance, the timestamp. The interface presents facts the system verified, not claims a stranger made.
2. **Calm under money.** Screens where money moves are quiet, explicit and unhurried. No urgency devices, no countdown pressure, no dark patterns. Confidence reads as calm.
3. **Legible in sunlight, one-handed.** A worker uses this outdoors, standing in a shop, on a mid-range Android with one hand. That is the real operating condition, not a desktop browser.

This rules out the default startup look: purple gradients, glassmorphism, floating 3D shapes. OnSite should feel closer to a well-made instrument than to a landing page template.

## Brand

**OnSite** — someone on the ground, wherever you need them.

Voice: direct, concrete, never coy. "Worker arrived, 38 m from the store" rather than "Great news! Your task is progressing!" Numbers are given plainly. Bad news is delivered plainly and early.

## Color

Warm neutrals rather than cold grays, which alone separates this from most software. State colors are conventional on purpose: in a trust product, a person must read status correctly at a glance, and novelty there costs more than it gains.

```css
:root {
  /* Brand — confident blue. Actions, links, active states, map pins */
  --brand-50:  #EEF2FE;
  --brand-100: #E0E7FD;
  --brand-500: #3D63E8;
  --brand-600: #2B4FD8;   /* primary */
  --brand-700: #1E3BAA;   /* hover, pressed */

  /* Ink — warm-leaning near-black, never pure #000 */
  --ink-900: #0E1116;     /* primary text */
  --ink-700: #1C2230;
  --ink-500: #4A5468;     /* secondary text */
  --ink-400: #6B7688;
  --ink-300: #8A94A6;     /* tertiary, placeholders */

  /* Paper — warm off-white, not clinical white */
  --paper-0:  #FFFFFF;    /* cards */
  --paper-50: #FAF9F7;    /* page background */
  --paper-100:#F3F1ED;    /* subtle fills */
  --line:     #E6E4E0;    /* borders */

  /* State language — consistent on every surface, no exceptions */
  --verified: #0F8A5F;    /* verified, complete, paid */
  --progress: #C77A17;    /* in progress, awaiting, en route */
  --dispute:  #C4342A;    /* disputed, failed, rejected */
  --info:     #2B4FD8;
}

:root[data-theme="dark"],
:root:not([data-theme="light"]) { /* under prefers-color-scheme: dark */
  --ink-900: #F4F5F7;
  --ink-500: #A8B0BF;
  --paper-0:  #161A21;
  --paper-50: #0E1116;
  --paper-100:#1E2430;
  --line:     #2A313D;
  --brand-600:#5B7CF0;    /* lifted for contrast on dark */
  --verified: #2FA97A;
  --progress: #E0973A;
  --dispute:  #E05B4F;
}
```

**Dark mode is required, not optional.** Workers use this at night and outdoors. Every screen ships in both, and both are checked.

State color is never the only signal. Every status carries an icon and a label, because color alone fails for color-blind users and in direct sunlight.

## Typography

**Inter**, with a tighter optical treatment at display sizes. One family, well used, beats two families poorly paired.

```css
--font-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;

/* Every number the user compares or acts on */
.tabular { font-variant-numeric: tabular-nums; }
```

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Display | 44–56px | 700 | −0.02em |
| H1 | 32px | 700 | −0.015em |
| H2 | 24px | 650 | −0.01em |
| H3 | 19px | 600 | normal |
| Body | 16px | 400 | normal |
| Small | 14px | 400 | normal |
| Caption | 13px | 500 | 0.01em |
| Numeric | inherits | 600 | tabular |

**Tabular numerals are mandatory** for money, distance, ratings, counts and countdowns. Money and distances appear constantly and in lists; proportional digits make them jitter and misalign, which reads as sloppiness in exactly the place trust is being built.

Body text never below 16px on worker surfaces. Line length capped near 68 characters.

## Space, radius, elevation

4px base scale: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

Radius: 8px inputs, 12px cards, 16px sheets and modals, 999px pills and avatars.

Elevation, only two levels. Depth is not decoration.

```css
--shadow-card:  0 1px 2px rgb(14 17 22 / 0.06), 0 1px 3px rgb(14 17 22 / 0.04);
--shadow-float: 0 4px 12px rgb(14 17 22 / 0.10), 0 2px 4px rgb(14 17 22 / 0.06);
```

## Density modes

The same components, two densities, switched by a data attribute on a layout wrapper.

```css
[data-surface="worker"] { --tap-min: 48px; --density: 1.15; }
[data-surface="app"]    { --tap-min: 40px; --density: 1;    }
```

**Worker surfaces get larger tap targets, larger type and higher contrast.** A worker is standing in a shop, one-handed, possibly in bright sun. Requester surfaces are usually read seated and can be denser.

Minimum tap target is 44px everywhere, 48px on worker surfaces. No exceptions for icon buttons.

## Components

Built on shadcn/ui, restyled to these tokens rather than used at defaults.

**Primitives:** Button (primary, secondary, ghost, destructive; all with loading and disabled states), Input, Select, Textarea, Checkbox, Radio, Switch, Slider, DatePicker, Badge, Avatar, Card, Sheet, Dialog, Tabs, Toast, Skeleton, EmptyState.

**Domain components, the ones that carry the product:**

| Component | Purpose |
|---|---|
| `TaskCard` | Feed item: category icon, title, **distance**, **payout**, deadline, requester rating. Distance and payout are the two things a worker reads first, so they are the most prominent |
| `StatusPill` | Task status. Icon plus label plus state color, identical everywhere |
| `TrustBadge` | Verification level, rating, completion rate, task count. Readable in two seconds |
| `TaskTimeline` | Vertical status progression with timestamps and map |
| `ProofTile` | One piece of evidence with its verification metadata |
| `EvidenceViewer` | Full-screen proof review with metadata overlay |
| `MoneyBreakdown` | Budget, commission, payout. Always shows all three |
| `LocationPicker` | Places autocomplete plus map confirmation |
| `ProofChecklist` | Required proof with completion state |
| `GeofenceIndicator` | Measured distance from the task location, with its flag |

## The four moments worth extra craft

Most screens should be quietly competent. These four carry the product's credibility and deserve real attention.

### 1. Live task timeline

The requester watching work happen in a city they cannot see. This screen is why remote feels safe rather than reckless.

A vertical timeline of completed and pending states, each completed step with its timestamp, a map showing the task location and the worker's verified arrival point, and the current state animating gently so the page feels alive without demanding attention. Real-time updates arrive over the socket and slide in; they never jump the scroll position.

### 2. Evidence viewer

Where the product proves itself.

Full-bleed photograph or video, with metadata presented as **verified facts** rather than captions: capture time, measured distance from the task location, geofence result. Verification flags are shown honestly, including unfavourable ones. A photo captured 3 km away says so. Hiding that would destroy the only thing that makes the evidence worth anything.

Swipe between proofs, pinch to zoom, structured fields such as price and serial number displayed alongside rather than buried.

### 3. Trust badge and worker profile

What a requester reads before deciding to trust a stranger.

Verification level as a ladder showing what is complete and what is not. Rating with its count, because 4.9 from 187 tasks is a different claim from 5.0 from one. Completion rate, category experience, member since. Components shown separately, never collapsed into one opaque score.

### 4. Task creation wizard

Where a first-time requester decides whether this service is worth trusting. It collects a great deal: two locations, category, proof requirements, budget, deadline, detailed instructions. It must not feel like a form.

Steps, one decision per screen, with progress always visible and back always safe. The category chosen first, because it presets proof requirements and price range and makes everything after it easier. Live map confirmation of the task location, since getting it wrong wastes everyone's time. **The money breakdown shown before payment, in full**, with no surprise at the final step.

## Motion

```css
--ease: cubic-bezier(0.2, 0, 0, 1);
--dur-micro: 120ms;    /* hover, press */
--dur-base:  220ms;    /* enter, exit, expand */
--dur-page:  320ms;    /* route transitions */
```

Motion communicates causality: a new task sliding into the feed, a status advancing on the timeline, a proof tile settling after upload. It never decorates.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Accessibility

Not a later pass.

- Contrast at least 4.5:1 for body text, 3:1 for large text and interactive boundaries, in **both** themes.
- Every interactive element keyboard reachable, in a sensible order, with a visible focus ring. The focus ring is never removed.
- Every icon-only button has an accessible label.
- Form errors are associated with their field and announced, never color alone.
- Status changes announced through a live region.
- Zoom to 200% without loss of function.
- Target: Lighthouse accessibility 100 on the landing page and the worker feed.

## Screens

| Surface | Screens |
|---|---|
| Marketing | Landing, how it works, for workers, pricing, trust and safety, legal |
| Auth | Sign in, sign up, verify email, verify phone, reset password |
| Requester | Dashboard, task creation wizard, task detail with live timeline, evidence review, chat, payment, history |
| Worker | Onboarding with KYC, task feed, task detail, active task execution, proof capture, submission, earnings |
| Shared | Profile, trust page, notifications, settings, dispute |
| Admin | Dashboard, KYC queue, dispute queue, users, tasks, payments, configuration |

## Performance budget

The worker feed is the screen that decides whether the product feels good on a mid-range Android on a patchy connection.

| Metric | Target |
|---|---|
| Largest Contentful Paint, mid-tier mobile, throttled | < 2.5s |
| Interaction to Next Paint | < 200ms |
| Cumulative Layout Shift | < 0.1 |
| Initial JS for the feed | < 180KB gzipped |
| Lighthouse performance, landing and feed | ≥ 90 |

Server Components by default. Images through the Next.js image pipeline with explicit dimensions, so nothing shifts as it loads. Skeletons that match the shape of the content they replace, never spinners.
