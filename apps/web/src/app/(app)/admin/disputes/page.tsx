'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api-client';

interface DisputeQueueItem {
  id: string;
  taskId: string;
  taskTitle: string;
  reason: string;
  status: string;
  createdAt: string;
  ageHours: number;
}

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<DisputeQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ data: DisputeQueueItem[] }>('/admin/disputes?limit=20')
      .then(({ data }) => setDisputes(data))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the dispute queue.'));
  }, []);

  if (error) return <p className="text-sm text-dispute">{error}</p>;
  if (!disputes) {
    return (
      <Card>
        <CardContent className="flex flex-col divide-y divide-line p-0">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-6 py-4">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }
  if (disputes.length === 0) {
    return <EmptyState title="Queue is empty" description="No disputes are open right now." />;
  }

  return (
    <Card>
      <CardContent className="flex flex-col divide-y divide-line p-0">
        {disputes.map((d) => (
          <Link
            key={d.id}
            href={`/admin/disputes/${d.id}`}
            className="flex items-center justify-between gap-4 px-6 py-4 transition-colors duration-micro ease-onsite hover:bg-paper-100"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-ink-900">{d.taskTitle}</p>
              <p className="text-sm text-ink-500">{d.reason.replace(/_/g, ' ').toLowerCase()}</p>
            </div>
            <span className={`tabular shrink-0 text-sm ${d.ageHours > 48 ? 'font-semibold text-dispute' : 'text-ink-400'}`}>
              {d.ageHours}h old
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
