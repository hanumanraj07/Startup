'use client';

import { useEffect, useState } from 'react';
import { formatPaise } from '@onsite/money';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api-client';

interface DashboardMetrics {
  usersTotal: number;
  activeWorkers: number;
  verifiedL2Plus: number;
  tasksToday: number;
  completedToday: number;
  inProgress: number;
  disputesOpen: number;
  completionRate: number | null;
  medianTimeToMatchMinutes: number | null;
  acceptanceRate: number | null;
  gmvTodayPaise: number;
  commissionTodayPaise: number;
  pendingPayoutsPaise: number;
  kycQueueCount: number;
  flaggedTasks: number;
  safetyReports: number;
  byCity: { city: string; tasksToday: number }[];
}

export default function AdminDashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DashboardMetrics>('/admin/metrics')
      .then(setMetrics)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load dashboard metrics.'));
  }, []);

  if (error) return <p className="text-sm text-dispute">{error}</p>;
  if (!metrics) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex flex-col gap-2 pt-6">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value={String(metrics.usersTotal)} />
        <Stat label="Tasks today" value={String(metrics.tasksToday)} />
        <Stat label="Active workers" value={String(metrics.activeWorkers)} />
        <Stat label="Completed today" value={String(metrics.completedToday)} />
        <Stat label="Verified (L2+)" value={String(metrics.verifiedL2Plus)} />
        <Stat label="In progress" value={String(metrics.inProgress)} />
        <Stat label="Disputed" value={String(metrics.disputesOpen)} highlight={metrics.disputesOpen > 0} />
        <Stat label="Safety reports" value={String(metrics.safetyReports)} highlight={metrics.safetyReports > 0} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Completion rate"
          value={metrics.completionRate !== null ? `${metrics.completionRate}%` : '—'}
          emphasize
        />
        <Stat
          label="Median time to match"
          value={metrics.medianTimeToMatchMinutes !== null ? `${metrics.medianTimeToMatchMinutes}m` : '—'}
          emphasize
        />
        <Stat
          label="Acceptance rate"
          value={metrics.acceptanceRate !== null ? `${metrics.acceptanceRate}%` : '—'}
          emphasize
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="GMV today" value={formatPaise(metrics.gmvTodayPaise)} />
        <Stat label="Commission today" value={formatPaise(metrics.commissionTodayPaise)} />
        <Stat label="Pending payouts" value={formatPaise(metrics.pendingPayoutsPaise)} />
        <Stat label="KYC queue" value={String(metrics.kycQueueCount)} highlight={metrics.kycQueueCount > 0} />
        <Stat label="Flagged tasks" value={String(metrics.flaggedTasks)} highlight={metrics.flaggedTasks > 0} />
      </div>

      {metrics.byCity.length > 0 ? (
        <div>
          <h2 className="mb-3 text-[17px] font-semibold text-ink-900">Tasks today, by city</h2>
          <Card>
            <CardContent className="flex flex-col divide-y divide-line p-0">
              {metrics.byCity.map((row) => (
                <div key={row.city} className="flex items-center justify-between px-6 py-3 text-sm">
                  <span className="text-ink-700">{row.city}</span>
                  <span className="tabular font-medium text-ink-900">{row.tasksToday}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  highlight,
  emphasize,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
  emphasize?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-6">
        <span className="text-sm text-ink-500">{label}</span>
        <span
          className={`tabular font-bold text-ink-900 ${emphasize ? 'text-3xl' : 'text-2xl'} ${highlight ? 'text-dispute' : ''}`}
        >
          {value}
        </span>
        {hint ? <span className="text-xs text-ink-400">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}
