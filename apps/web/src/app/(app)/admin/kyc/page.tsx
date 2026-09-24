'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api-client';

interface KycQueueItem {
  id: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  documentType: string;
  documentFrontUrl: string;
  documentBackUrl: string | null;
  selfieUrl: string;
  documentNumber: string;
  createdAt: string;
}

export default function AdminKycPage() {
  const [queue, setQueue] = useState<KycQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  function load() {
    api
      .get<{ data: KycQueueItem[] }>('/admin/kyc?limit=20')
      .then(({ data }) => setQueue(data))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the KYC queue.'));
  }

  useEffect(load, []);

  async function decide(id: string, decision: 'APPROVE' | 'REJECT' | 'RESUBMIT') {
    setBusyId(id);
    try {
      await api.post(`/admin/kyc/${id}/decision`, { decision, reason: reasons[id] });
      setQueue((q) => q?.filter((item) => item.id !== id) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record that decision.');
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <p className="text-sm text-dispute">{error}</p>;
  if (!queue) {
    return (
      <div className="flex flex-col gap-4">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Skeleton className="aspect-[4/3] w-full" />
                <Skeleton className="aspect-[4/3] w-full" />
                <Skeleton className="aspect-[4/3] w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  if (queue.length === 0) {
    return <EmptyState title="Queue is empty" description="No KYC submissions are waiting for review." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {queue.map((item) => (
        <Card key={item.id}>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-ink-900">{item.userDisplayName}</p>
                <p className="text-sm text-ink-500">{item.userEmail}</p>
              </div>
              <span className="text-xs text-ink-400">{new Date(item.createdAt).toLocaleString('en-IN')}</span>
            </div>

            <p className="text-sm">
              <span className="text-ink-500">{item.documentType.replace(/_/g, ' ').toLowerCase()}:</span>{' '}
              <span className="tabular font-medium text-ink-900">{item.documentNumber}</span>
            </p>

            <div className="grid grid-cols-3 gap-2">
              <Photo label="Front" url={item.documentFrontUrl} />
              {item.documentBackUrl ? <Photo label="Back" url={item.documentBackUrl} /> : null}
              <Photo label="Selfie" url={item.selfieUrl} />
            </div>

            <Textarea
              placeholder="Reason (required to reject or ask for resubmission)"
              value={reasons[item.id] ?? ''}
              onChange={(e) => setReasons((r) => ({ ...r, [item.id]: e.target.value }))}
              rows={2}
            />

            <div className="flex gap-2">
              <Button loading={busyId === item.id} onClick={() => decide(item.id, 'APPROVE')}>
                Approve
              </Button>
              <Button
                variant="secondary"
                disabled={!reasons[item.id]?.trim()}
                loading={busyId === item.id}
                onClick={() => decide(item.id, 'RESUBMIT')}
              >
                Ask to resubmit
              </Button>
              <Button
                variant="destructive"
                disabled={!reasons[item.id]?.trim()}
                loading={busyId === item.id}
                onClick={() => decide(item.id, 'REJECT')}
              >
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Photo({ label, url }: { label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element -- presigned, short-lived URL */}
      <img src={url} alt={label} className="aspect-[4/3] w-full rounded-input border border-line object-cover" />
      <span className="mt-1 block text-center text-xs text-ink-400">{label}</span>
    </a>
  );
}
