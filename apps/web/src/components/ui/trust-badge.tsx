import { Check } from 'lucide-react';
import type { PublicWorker } from '@onsite/types';
import { cn } from '@/lib/utils';

const LEVELS: { level: number; label: string }[] = [
  { level: 1, label: 'Email and phone verified' },
  { level: 2, label: 'Government ID checked' },
  { level: 3, label: 'Address verified' },
  { level: 4, label: '50+ completions, 4.5+ rating' },
  { level: 5, label: 'Professional tier' },
];

/**
 * What a requester reads before trusting a stranger. Every component is
 * shown separately — never collapsed into one opaque score — per
 * docs/19-ui-design-system.md: "4.9 from 187 tasks is a different claim from
 * 5.0 from one."
 */
export function TrustBadge({ worker }: { worker: PublicWorker }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Rating"
          value={worker.ratingAvg !== null ? worker.ratingAvg.toFixed(1) : '—'}
          hint={worker.ratingCount > 0 ? `${worker.ratingCount} ratings` : 'No ratings yet'}
        />
        <Stat label="Tasks completed" value={String(worker.tasksCompleted)} />
        <Stat
          label="Completion rate"
          value={worker.completionRate !== null ? `${Math.round(worker.completionRate)}%` : '—'}
        />
        <Stat
          label="Member since"
          value={new Date(worker.memberSince).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
        />
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-ink-700">Verification level {worker.verificationLevel} of 5</p>
        <ol className="flex flex-col gap-2">
          {LEVELS.map((l) => {
            const reached = worker.verificationLevel >= l.level;
            return (
              <li key={l.level} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs',
                    reached ? 'bg-verified text-white' : 'bg-paper-100 text-ink-300',
                  )}
                >
                  {reached ? <Check className="h-3 w-3" aria-hidden /> : l.level}
                </span>
                <span className={reached ? 'text-ink-900' : 'text-ink-400'}>{l.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="tabular text-xl font-bold text-ink-900">{value}</span>
      <span className="text-xs text-ink-500">{label}</span>
      {hint ? <span className="text-xs text-ink-300">{hint}</span> : null}
    </div>
  );
}
