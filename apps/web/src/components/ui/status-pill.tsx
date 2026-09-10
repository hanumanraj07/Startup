import type { TaskStatus } from '@onsite/types';
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
 * icon and a text label.
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
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {meta.label}
    </span>
  );
}
