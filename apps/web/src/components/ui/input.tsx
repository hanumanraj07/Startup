import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex w-full min-h-[var(--tap-min,44px)] rounded-input border bg-paper-0 px-3.5 text-base text-ink-900',
        'placeholder:text-ink-300 transition-colors duration-micro ease-onsite',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid ? 'border-dispute' : 'border-line',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
