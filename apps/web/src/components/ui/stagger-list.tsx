'use client';

import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * A staggered entrance for short lists (feed cards, task rows, category
 * grids). Each child pops in with the same spring used elsewhere in the app
 * (status-pill.tsx / category-badge.tsx: stiffness ~260-320, damping ~14-16)
 * so this reads as the same motion system, not a new one.
 *
 * ONLY for short, non-virtualized lists (~20 items or fewer) — staggering a
 * long list is both a performance risk and reads as slow, not delightful.
 *
 * The caller controls whether a re-render replays the animation: keep the
 * `key` on this component (or its parent) stable across a background
 * refetch (e.g. a polling interval) so results silently update in place
 * without re-triggering entrance motion; change the key only on a genuine
 * new view (initial mount, a real navigation, a changed filter).
 */
const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 300, damping: 26 } },
};

export function StaggerList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={container} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}
