'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatPaise } from '@onsite/money';
import type { PayoutStatus } from '@onsite/types';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface WorkerStats {
  ratingAvg: number | null;
  ratingCount: number;
  tasksCompleted: number;
  tasksAccepted: number;
  tasksOffered: number;
  completionRate: number | null;
  responseRate: number | null;
}

interface PayoutRow {
  id: string;
  taskId: string;
  taskTitle: string;
  amountPaise: number;
  status: PayoutStatus;
  processedAt: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<PayoutStatus, string> = {
  PENDING: 'bg-progress/10 text-progress',
  PROCESSING: 'bg-progress/10 text-progress',
  PROCESSED: 'bg-verified/10 text-verified',
  FAILED: 'bg-dispute/10 text-dispute',
  REVERSED: 'bg-dispute/10 text-dispute',
};

export default function EarningsPage() {
  const [stats, setStats] = useState<WorkerStats | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<WorkerStats>('/workers/me/stats'),
      api.get<{ data: PayoutRow[] }>('/payouts/mine?limit=50'),
    ])
      .then(([s, p]) => {
        setStats(s);
        setPayouts(p.data);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load your earnings.'));
  }, []);

  const totalPaise = payouts?.reduce((sum, p) => sum + p.amountPaise, 0) ?? 0;
  const paidPaise = payouts?.filter((p) => p.status === 'PROCESSED').reduce((sum, p) => sum + p.amountPaise, 0) ?? 0;

  if (error) return <p className="text-sm text-dispute">{error}</p>;
  if (!stats || !payouts) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="grid grid-cols-2 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Card key={i}>
              <CardContent className="flex flex-col gap-2 pt-6">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-bold tracking-tight text-ink-900">Earnings</h1>
        <p className="mt-1 text-ink-500">Every component shown separately — never one opaque score.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StatTile label="Total earned" value={formatPaise(totalPaise)} />
        <StatTile label="Paid out" value={formatPaise(paidPaise)} />
        <StatTile
          label="Rating"
          value={stats.ratingAvg !== null ? `${stats.ratingAvg.toFixed(1)} ★` : 'No ratings yet'}
          hint={stats.ratingCount > 0 ? `from ${stats.ratingCount} tasks` : undefined}
        />
        <StatTile label="Tasks completed" value={String(stats.tasksCompleted)} />
        <StatTile
          label="Completion rate"
          value={stats.completionRate !== null ? `${Math.round(stats.completionRate * 100)}%` : '—'}
        />
        <StatTile
          label="Response rate"
          value={stats.responseRate !== null ? `${Math.round(stats.responseRate * 100)}%` : '—'}
        />
      </div>

      <div>
        <h2 className="mb-3 text-[19px] font-semibold text-ink-900">Payout history</h2>
        {payouts.length === 0 ? (
          <EmptyState title="No payouts yet" description="Complete a task and its payout will show up here." />
        ) : (
          <Card>
            <CardContent className="flex flex-col divide-y divide-line p-0">
              {payouts.map((p) => (
                <Link
                  key={p.id}
                  href={`/tasks/${p.taskId}`}
                  className="flex items-center justify-between gap-4 px-6 py-4 transition-colors duration-micro ease-onsite hover:bg-paper-100"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{p.taskTitle}</p>
                    <p className="text-sm text-ink-400">
                      {new Date(p.processedAt ?? p.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="tabular font-semibold text-verified">{formatPaise(p.amountPaise)}</span>
                    <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', STATUS_TONE[p.status])}>
                      {p.status.toLowerCase()}
                    </span>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-6">
        <span className="text-sm text-ink-500">{label}</span>
        <span className="tabular text-2xl font-bold text-ink-900">{value}</span>
        {hint ? <span className="text-xs text-ink-400">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}
