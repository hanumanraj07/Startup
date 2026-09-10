import { Clock, MapPin, ShieldCheck } from 'lucide-react';
import { formatPaise } from '@onsite/money';
import { categoryIcon } from '@/lib/category-icons';
import { Button } from './button';
import { Card } from './card';

export interface FeedTask {
  id: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  categoryIcon: string;
  distanceMeters: number;
  distanceLabel: string;
  payoutPaise: number;
  deadlineAt: string;
  approximateAddress: string;
  requester: { displayName: string; verificationLevel: number };
}

/**
 * The feed item. Distance and payout are what a worker reads first, per
 * docs/19-ui-design-system.md, so they get the most visual weight — larger,
 * tabular, above the fold of the card.
 */
export function TaskCard({
  task,
  onAccept,
  accepting,
}: {
  task: FeedTask;
  onAccept: (id: string) => void;
  accepting: boolean;
}) {
  const Icon = categoryIcon(task.categoryIcon);
  const deadline = new Date(task.deadlineAt);
  const hoursLeft = Math.max(0, Math.round((deadline.getTime() - Date.now()) / 3_600_000));

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Icon className="h-4 w-4" aria-hidden />
          {task.categoryName}
        </div>
        <span className="tabular text-lg font-bold text-verified">{formatPaise(task.payoutPaise)}</span>
      </div>

      <h3 className="mt-2 text-[17px] font-semibold text-ink-900">{task.title}</h3>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-500">
        <span className="tabular flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" aria-hidden /> {task.distanceLabel} &middot; {task.approximateAddress}
        </span>
        <span className="tabular flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" aria-hidden /> {hoursLeft}h left
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <span className="flex items-center gap-1.5 text-sm text-ink-500">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {task.requester.displayName} &middot; level {task.requester.verificationLevel}
        </span>
        <Button size="sm" loading={accepting} onClick={() => onAccept(task.id)}>
          Accept
        </Button>
      </div>
    </Card>
  );
}
