import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex w-full min-h-[100px] rounded-input border bg-paper-0 px-3.5 py-2.5 text-base text-ink-900',
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
Textarea.displayName = 'Textarea';
