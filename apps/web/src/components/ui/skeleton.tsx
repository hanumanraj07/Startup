import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Base loading primitive. Per docs/19-ui-design-system.md: skeletons match
 * the shape of the content they replace, never a generic spinner. Compose
 * this into shape-matched skeletons per screen (e.g. a TaskCardSkeleton)
 * rather than using it bare for a whole page.
 *
 * Plain CSS `animate-pulse` — no framer-motion cost, and it already respects
 * `prefers-reduced-motion` via the global override in globals.css.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-input bg-paper-100', className)} {...props} />;
}
