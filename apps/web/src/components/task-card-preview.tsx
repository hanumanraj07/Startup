import { StatusPill } from './status-pill';

/**
 * A static preview of the TaskCard component described in
 * docs/19-ui-design-system.md, built from the founding example. Distance and
 * payout are the two things a worker reads first, so they lead visually.
 */
export function TaskCardPreview() {
  return (
    <div className="w-full max-w-sm rounded-card border border-line bg-paper-0 p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
            Product inspection
          </p>
          {/* Not a real heading: this is a static mockup of a feed card inside the
              marketing page's hero, not a named section of the document. */}
          <p className="mt-1 text-lg font-semibold text-ink-900">
            Inspect MacBook Air M4 at XYZ Computer Store
          </p>
        </div>
        <StatusPill tone="progress">Open</StatusPill>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-ink-400">Distance</dt>
          <dd className="tabular font-semibold text-ink-900">2.1 km</dd>
        </div>
        <div>
          <dt className="text-ink-400">You receive</dt>
          <dd className="tabular font-semibold text-verified">₹425</dd>
        </div>
        <div>
          <dt className="text-ink-400">Deadline</dt>
          <dd className="tabular text-ink-700">Today, 6:00 PM</dd>
        </div>
        <div>
          <dt className="text-ink-400">Requester</dt>
          <dd className="tabular text-ink-700">4.8 ★ · 12 tasks</dd>
        </div>
      </dl>

      <button
        type="button"
        className="mt-5 w-full rounded-input bg-brand-solid py-2.5 text-sm font-semibold text-white transition-colors duration-micro ease-onsite hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        View task
      </button>
    </div>
  );
}
