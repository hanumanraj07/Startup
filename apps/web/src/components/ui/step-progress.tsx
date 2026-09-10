import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StepProgress({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done && 'bg-verified text-white',
                active && 'bg-brand-solid text-white',
                !done && !active && 'bg-paper-100 text-ink-400',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
            </div>
            <span className={cn('hidden text-sm sm:inline', active ? 'font-medium text-ink-900' : 'text-ink-400')}>
              {label}
            </span>
            {i < steps.length - 1 ? <div className="h-px flex-1 bg-line" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
