'use client';

import { motion } from 'framer-motion';
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
                'transition-colors duration-base ease-onsite',
                done && 'bg-verified text-white',
                active && 'bg-brand-solid text-white',
                !done && !active && 'bg-paper-100 text-ink-400',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? (
                // Same one-shot spring pop as StatusPill's "verified" tone —
                // the moment a step completes is a "this just happened," not
                // an ongoing state.
                <motion.span
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 14 }}
                  className="inline-flex"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden />
                </motion.span>
              ) : (
                i + 1
              )}
            </div>
            <span className={cn('hidden text-sm sm:inline', active ? 'font-medium text-ink-900' : 'text-ink-400')}>
              {label}
            </span>
            {i < steps.length - 1 ? (
              <div className="relative h-px flex-1 bg-line">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-verified"
                  initial={false}
                  animate={{ width: done ? '100%' : '0%' }}
                  transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
