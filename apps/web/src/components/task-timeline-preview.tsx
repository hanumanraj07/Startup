interface Step {
  label: string;
  time: string;
  done: boolean;
  current?: boolean;
}

const STEPS: Step[] = [
  { label: 'Task funded and published', time: '11:02 AM', done: true },
  { label: 'Rahul S. accepted', time: '11:14 AM', done: true },
  { label: 'Arrived at XYZ Computer Store', time: '11:52 AM · 38 m from pin', done: true },
  { label: 'Evidence submitted', time: '12:10 PM', done: false, current: true },
  { label: 'Your review', time: 'awaiting', done: false },
];

/**
 * A static preview of the live task timeline, the screen the design doc calls
 * the one that "makes remote feel safe." Every completed step carries a
 * timestamp; nothing is asserted without a time attached to it.
 */
export function TaskTimelinePreview() {
  return (
    <div className="w-full max-w-sm rounded-card border border-line bg-paper-0 p-5 shadow-card">
      <p className="text-sm font-semibold text-ink-900">Inspect MacBook Air M4</p>
      <p className="text-xs text-ink-400">Kolkata, West Bengal</p>

      <ol className="mt-4 space-y-0">
        {STEPS.map((step, i) => (
          <li key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                className={`absolute left-[7px] top-4 h-full w-px ${
                  step.done ? 'bg-verified' : 'bg-line'
                }`}
              />
            )}
            <span
              aria-hidden
              className={`relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                step.done
                  ? 'border-verified bg-verified'
                  : step.current
                    ? 'border-progress bg-paper-0'
                    : 'border-line bg-paper-0'
              }`}
            />
            <div className="min-w-0">
              <p
                className={`text-sm ${step.done || step.current ? 'font-medium text-ink-900' : 'text-ink-400'}`}
              >
                {step.label}
              </p>
              <p className="tabular text-xs text-ink-400">{step.time}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
