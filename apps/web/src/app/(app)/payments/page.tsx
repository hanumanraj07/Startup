'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { formatPaise } from '@onsite/money';
import type { PaymentStatus } from '@onsite/types';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface PaymentRow {
  id: string;
  taskId: string;
  taskTitle: string;
  status: PaymentStatus;
  amountPaise: number;
  capturedAt: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<PaymentStatus, string> = {
  CREATED: 'bg-paper-100 text-ink-500',
  AUTHORIZED: 'bg-progress/10 text-progress',
  CAPTURED: 'bg-progress/10 text-progress',
  HELD: 'bg-progress/10 text-progress',
  RELEASED: 'bg-verified/10 text-verified',
  REFUNDED: 'bg-paper-100 text-ink-500',
  PARTIALLY_REFUNDED: 'bg-paper-100 text-ink-500',
  FAILED: 'bg-dispute/10 text-dispute',
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ data: PaymentRow[] }>('/payments/mine?limit=50')
      .then(({ data }) => setPayments(data))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load your payment history.'));
  }, []);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-bold tracking-tight text-ink-900">Payment history</h1>
        <p className="mt-1 text-ink-500">Every task you've funded, and where the money stands.</p>
      </div>

      {error ? (
        <p className="text-sm text-dispute">{error}</p>
      ) : !payments ? (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading&hellip;
        </div>
      ) : payments.length === 0 ? (
        <EmptyState title="No payments yet" description="Fund a task and it will show up here." />
      ) : (
        <Card>
          <CardContent className="flex flex-col divide-y divide-line p-0">
            {payments.map((p) => (
              <Link
                key={p.id}
                href={`/tasks/${p.taskId}`}
                className="flex items-center justify-between gap-4 px-6 py-4 transition-colors duration-micro ease-onsite hover:bg-paper-100"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900">{p.taskTitle}</p>
                  <p className="text-sm text-ink-400">
                    {new Date(p.capturedAt ?? p.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tabular font-semibold text-ink-900">{formatPaise(p.amountPaise)}</span>
                  <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', STATUS_TONE[p.status])}>
                    {p.status.replace(/_/g, ' ').toLowerCase()}
                  </span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
