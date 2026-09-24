'use client';

import { useEffect, useState } from 'react';
import type { TaskStatus } from '@onsite/types';
import { formatPaise } from '@onsite/money';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface AdminTaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskFlags: string[];
  budgetPaise: number;
  createdAt: string;
}

const RISK_TONE: Record<AdminTaskRow['riskLevel'], string> = {
  LOW: 'bg-paper-100 text-ink-500',
  MEDIUM: 'bg-progress/10 text-progress',
  HIGH: 'bg-dispute/10 text-dispute',
};

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<AdminTaskRow[] | null>(null);
  const [riskFilter, setRiskFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = riskFilter ? `&riskLevel=${riskFilter}` : '';
    api
      .get<{ data: AdminTaskRow[] }>(`/admin/tasks?limit=50${query}`)
      .then(({ data }) => setTasks(data))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load tasks.'));
  }, [riskFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {[null, 'MEDIUM', 'HIGH'].map((level) => (
          <button
            key={level ?? 'all'}
            onClick={() => setRiskFilter(level)}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-micro ease-onsite',
              riskFilter === level ? 'bg-brand-solid text-white' : 'bg-paper-100 text-ink-500 hover:text-ink-900',
            )}
          >
            {level ?? 'All'} {level ? 'risk' : ''}
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-dispute">{error}</p>
      ) : !tasks ? (
        <Card>
          <CardContent className="flex flex-col divide-y divide-line p-0">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4 px-6 py-4">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-48" />
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col divide-y divide-line p-0">
            {tasks.map((t) => (
              // Not linked to /tasks/:id: that endpoint is party-only
              // (requester or assigned worker), and there is no separate
              // admin task-detail endpoint — oversight here is list-only,
              // by what the API actually exposes.
              <div key={t.id} className="flex items-center justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900">{t.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusPill status={t.status} />
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', RISK_TONE[t.riskLevel])}>
                      {t.riskLevel.toLowerCase()} risk
                    </span>
                  </div>
                </div>
                <span className="tabular shrink-0 font-semibold text-ink-900">{formatPaise(t.budgetPaise)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
