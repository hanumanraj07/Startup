'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
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
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading&hellip;
      </div>
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
