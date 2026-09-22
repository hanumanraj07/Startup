'use client';

import type { TaskStatus } from '@onsite/types';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  FileCheck2,
  MapPin,
  Navigation,
  PackageCheck,
  ScanSearch,
  Wallet,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One status -> one color -> one icon, identical everywhere. Color is never
 * the only signal (docs/19-ui-design-system.md): every pill also carries an
 * icon and a text label. This is the single most-reused status surface in
 * the app — task cards, the task detail header, the timeline, admin panels —
 * so animating it once here is what "status feels alive everywhere" turns
 * into in practice, rather than hand-wiring the same motion at every call
 * site (and inevitably drifting between them).
 */
const STATUS_META: Record<TaskStatus, { label: string; tone: 'progress' | 'verified' | 'dispute' | 'neutral'; icon: typeof Clock }> = {
  DRAFT: { label: 'Draft', tone: 'neutral', icon: FileCheck2 },
  PUBLISHED: { label: 'Published', tone: 'progress', icon: Clock },
  MATCHING: { label: 'Finding a worker', tone: 'progress', icon: ScanSearch },
  ASSIGNED: { label: 'Assigned', tone: 'progress', icon: PackageCheck },
  WORKER_EN_ROUTE: { label: 'Worker en route', tone: 'progress', icon: Navigation },
  ARRIVED: { label: 'Worker arrived', tone: 'progress', icon: MapPin },
  IN_PROGRESS: { label: 'In progress', tone: 'progress', icon: Clock },
  SUBMITTED: { label: 'Submitted for review', tone: 'progress', icon: FileCheck2 },
  UNDER_REVIEW: { label: 'Under review', tone: 'progress', icon: ScanSearch },
  COMPLETED: { label: 'Completed', tone: 'verified', icon: CheckCircle2 },
  PAYMENT_RELEASED: { label: 'Paid', tone: 'verified', icon: Wallet },
  DISPUTED: { label: 'Disputed', tone: 'dispute', icon: AlertTriangle },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: Ban },
  EXPIRED: { label: 'Expired', tone: 'neutral', icon: XCircle },
};

const TONE_CLASSES: Record<string, string> = {
  progress: 'bg-progress/10 text-progress',
  verified: 'bg-verified/10 text-verified',
  dispute: 'bg-dispute/10 text-dispute',
  neutral: 'bg-paper-100 text-ink-500',
};

export function StatusPill({ status, className }: { status: TaskStatus; className?: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium',
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      <StatusIcon Icon={Icon} tone={meta.tone} />
      {meta.label}
    </span>
  );
}

/**
 * The motion, keyed strictly to tone, not to the individual status: a
 * requester should learn once, from one signal, that "this pill is
 * breathing = something is actively happening" rather than memorizing
 * fourteen separate animations. See ai/memory.md's motion conventions.
 */
function StatusIcon({ Icon, tone }: { Icon: typeof Clock; tone: string }) {
  if (tone === 'progress') {
    // Breathing pulse — signals "currently active, still moving," per the
    // same motif used for anything live/being tracked.
    return (
      <motion.span
        className="inline-flex"
        animate={{ scale: [1, 1.18, 1], opacity: [0.75, 1, 0.75] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </motion.span>
    );
  }

  if (tone === 'verified') {
    // Spring pop-in, once — a small "landing" overshoot on the moment
    // something completes, then it settles and stays still. Looping this
    // would cheapen the one-time "it's done" signal into noise.
    return (
      <motion.span
        className="inline-flex"
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 14 }}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </motion.span>
    );
  }

  if (tone === 'dispute') {
    // A slow, deliberate attention pulse — noticeable without being
    // alarming, since a real person's dispute is being reviewed, not an
    // error state to panic over.
    return (
      <motion.span
        className="inline-flex"
        animate={{ scale: [1, 1.12, 1] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </motion.span>
    );
  }

  // Neutral (draft/cancelled/expired): genuinely inert, so genuinely static.
  return <Icon className="h-3.5 w-3.5" aria-hidden />;
}
