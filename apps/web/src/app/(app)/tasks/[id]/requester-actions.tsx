'use client';

import { useState } from 'react';
import type { TaskStatus } from '@onsite/types';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ProofTile, type ProofView } from '@/components/ui/proof-tile';
import { ApiError, api } from '@/lib/api-client';

export function RequesterActions({
  taskId,
  status,
  proofs,
  onChanged,
}: {
  taskId: string;
  status: TaskStatus;
  proofs: ProofView[];
  onChanged: () => Promise<void> | void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'SUBMITTED' && status !== 'UNDER_REVIEW') return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review the evidence</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {proofs.length === 0 ? (
          <p className="text-sm text-ink-500">No evidence submitted yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {proofs.map((p) => (
              <ProofTile key={p.id} proof={p} />
            ))}
          </div>
        )}

        {error ? <p className="text-sm text-dispute">{error}</p> : null}

        {rejecting ? (
          <div className="flex flex-col gap-2">
            <Textarea
              placeholder="What's missing or wrong? The worker will see this and can resubmit."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                loading={busy}
                disabled={reason.trim().length < 10}
                onClick={() => run(() => api.post(`/tasks/${taskId}/reject`, { reason: reason.trim() }))}
              >
                Send back for rework
              </Button>
              <Button variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button loading={busy} onClick={() => run(() => api.post(`/tasks/${taskId}/approve`))}>
              <Check className="h-4 w-4" aria-hidden /> Approve and release payment
            </Button>
            <Button variant="secondary" onClick={() => setRejecting(true)}>
              <X className="h-4 w-4" aria-hidden /> Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
