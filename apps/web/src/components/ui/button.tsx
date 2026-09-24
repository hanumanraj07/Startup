import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-card text-[15px] font-semibold ' +
    'transition-colors duration-micro ease-onsite disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-paper-0 min-h-[var(--tap-min,44px)] px-4',
  {
    variants: {
      variant: {
        // The accent orange is reserved for the main call-to-action —
        // moss green (brand-solid) fills non-CTA solid uses instead (map
        // pins, active-state chips), so the accent stays a rare, deliberate
        // highlight rather than the color of every button on the screen.
        primary: 'bg-accent-solid text-white hover:bg-accent-700 active:bg-accent-700',
        secondary: 'bg-paper-100 text-ink-900 border border-line hover:bg-paper-0',
        ghost: 'text-ink-900 hover:bg-paper-100',
        destructive: 'bg-dispute text-white hover:opacity-90',
        // Vibrant-tier only — hero CTAs and step-wizard "pay & publish"-style
        // moments, never a plain form submit. `primary` stays the workhorse
        // solid CTA everywhere else so the accent doesn't lose its meaning.
        gradient:
          'bg-accent-gradient text-white shadow-glow-accent hover:shadow-none hover:bg-accent-700',
      },
      size: {
        default: '',
        sm: 'min-h-[36px] px-3 text-sm',
        lg: 'min-h-[52px] px-6 text-base',
        icon: 'min-h-[var(--tap-min,44px)] w-[var(--tap-min,44px)] px-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    // Slot (asChild) requires exactly one React element child — it merges its
    // props onto that element rather than rendering a wrapper. Adding the
    // loading spinner alongside `children` (even as a `null` sibling) makes
    // it two children and Slot throws. asChild's own consumers (Link, etc.)
    // don't support an injected spinner anyway, so skip it in that case.
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
