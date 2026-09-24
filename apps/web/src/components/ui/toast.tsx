'use client';

import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const ToastProvider = ToastPrimitive.Provider;

export function ToastViewport({ className, ...props }: ToastPrimitive.ToastViewportProps) {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        'fixed bottom-0 right-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-4 sm:bottom-4 sm:right-4',
        className,
      )}
      {...props}
    />
  );
}

// No tailwindcss-animate plugin is installed in this project (see
// ai/memory.md's redesign plan) — enter/exit motion is a plain CSS
// transition keyed off Radix's own data-state, using the existing
// base/onsite tokens rather than a new animation vocabulary.
const toastVariants = cva(
  'pointer-events-auto relative flex w-full translate-y-0 items-start gap-3 rounded-card border p-4 opacity-100 shadow-elevated ' +
    'transition-all duration-base ease-onsite ' +
    'data-[state=closed]:translate-y-2 data-[state=closed]:opacity-0 ' +
    'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] ' +
    'data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=end]:opacity-0',
  {
    variants: {
      variant: {
        default: 'border-line bg-paper-0 text-ink-900',
        success: 'border-verified/30 bg-paper-0 text-ink-900',
        error: 'border-dispute/30 bg-paper-0 text-ink-900',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface ToastProps
  extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>,
    VariantProps<typeof toastVariants> {}

export const Toast = React.forwardRef<React.ElementRef<typeof ToastPrimitive.Root>, ToastProps>(
  ({ className, variant, ...props }, ref) => (
    <ToastPrimitive.Root ref={ref} className={cn(toastVariants({ variant }), className)} {...props} />
  ),
);
Toast.displayName = 'Toast';

export function ToastTitle({ className, ...props }: ToastPrimitive.ToastTitleProps) {
  return <ToastPrimitive.Title className={cn('text-sm font-semibold', className)} {...props} />;
}

export function ToastDescription({ className, ...props }: ToastPrimitive.ToastDescriptionProps) {
  return <ToastPrimitive.Description className={cn('mt-1 text-sm text-ink-500', className)} {...props} />;
}

export function ToastClose({ className, ...props }: ToastPrimitive.ToastCloseProps) {
  return (
    <ToastPrimitive.Close
      className={cn(
        'absolute right-2 top-2 rounded-input p-1 text-ink-400 hover:text-ink-900',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        className,
      )}
      {...props}
    >
      <X className="h-4 w-4" aria-hidden />
      <span className="sr-only">Dismiss</span>
    </ToastPrimitive.Close>
  );
}
