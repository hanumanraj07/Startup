'use client';

import { motion, useInView } from 'framer-motion';
import { type ReactNode, useRef } from 'react';

/**
 * Fades + slides a section in once, the first time it scrolls into view.
 * Reuses the same distance/duration/easing as PageTransition
 * (components/page-transition.tsx) and the tailwind `page`/`onsite` tokens,
 * so this reads as one motion system rather than a second vocabulary.
 *
 * Vibrant-tier only (marketing, dashboard, browsing surfaces) — never wrap a
 * money or evidence figure in this.
 */
export function ScrollReveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px 0px' });

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.32, ease: [0.2, 0, 0, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
