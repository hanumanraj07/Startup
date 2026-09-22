'use client';

import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Wraps route content so navigating between pages settles in rather than
 * popping. Keyed by pathname so AnimatePresence treats each route as a
 * distinct element and actually runs the exit/enter pair instead of
 * reusing the same node. `mode="wait"` (exit finishes before enter starts)
 * rather than the default overlap — two full pages of unrelated content
 * cross-fading through each other reads as a glitch, not a transition.
 *
 * A plain opacity/y transform only, so `useNativeDriver`-style GPU
 * compositing (the CSS equivalent: transform + opacity) is all that's ever
 * animated here — nothing layout-affecting, so this never causes reflow
 * jank on a slow device.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
