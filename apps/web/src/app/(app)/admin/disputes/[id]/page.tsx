'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { formatPaise } from '@onsite/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api-client';

interface EvidenceBundle {
  dispute: {
    id: string;
    reason: string;
    description: string;
    status: string;
    createdAt: string;
  };
  instructions: { title: string; description: string };
  chat: { senderId: string; body: string; redactionFlags: string[]; createdAt: string }[];
  proofs: {
    type: string;
    url: string | null;
    distanceFromTaskMeters: number | null;
    verificationFlags: string[];
    capturedAt: string | null;
    fieldKey: string | null;
    fieldValue: string | null;
    noteBody: string | null;
  }[];
  arrivalRecords: { distanceFromTaskMeters: number; isWithinGeofence: boolean; createdAt: string }[];
  statusHistory: { toStatus: string; actorRole: string; reason: string | null; createdAt: string }[];
  payment: { status: string; amountPaise: number } | null;
  parties: {
    requester: { displayName: string; verificationLevel: number; priorDisputes: number };
    worker: { displayName: string; verificationLevel: number; ratingAvg: number | null; priorDisputes: number } | null;
  };
}

export default function AdminDisputeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [bundle, setBundle] = useState<EvidenceBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [resolution, setResolution] = useState<'RELEASE_TO_WORKER' | 'REFUND_TO_REQUESTER' | 'SPLIT'>(
    'RELEASE_TO_WORKER',
  );
  const [workerSharePercent, setWorkerSharePercent] = useState('50');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get<EvidenceBundle>(`/admin/disputes/${params.id}/evidence`)
      .then(setBundle)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this dispute.'));
  }, [params.id]);

  async function resolve() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/admin/disputes/${params.id}/resolve`, {
        resolution,
        notes: notes.trim(),
        ...(resolution === 'SPLIT' ? { workerSharePercent: Number(workerSharePercent) } : {}),
      });
      router.push('/admin/disputes');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resolve this dispute.');
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return <p className="text-sm text-dispute">{error}</p>;
  if (!bundle) {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-1/2" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="flex flex-col gap-2 pt-6">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-24" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-2 pt-6">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-24" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{bundle.instructions.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          <p className="text-sm text-ink-500">
            Disputed: {bundle.dispute.reason.replace(/_/g, ' ').toLowerCase()}
          </p>
          <p className="text-sm text-ink-700">{bundle.dispute.description}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <PartyCard label="Requester" party={bundle.parties.requester} />
        {bundle.parties.worker ? <PartyCard label="Worker" party={bundle.parties.worker} /> : null}
      </div>

      {bundle.payment ? (
        <Card>
          <CardContent className="flex items-center justify-between pt-6 text-sm">
            <span className="text-ink-500">Held payment</span>
            <span className="tabular font-semibold text-ink-900">
              {formatPaise(bundle.payment.amountPaise)} ({bundle.payment.status.toLowerCase()})
            </span>
          </CardContent>
        </Card>
      ) : null}

      {bundle.proofs.length > 0 ? (
        <div>
          <h2 className="mb-3 text-[17px] font-semibold text-ink-900">Evidence</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {bundle.proofs.map((p, i) => (
              <Card key={i} className="overflow-hidden">
                {p.url && p.type === 'PHOTO' ? (
                  // eslint-disable-next-line @next/next/no-img-element -- presigned, short-lived URL
                  <img src={p.url} alt="Evidence" className="aspect-video w-full object-cover" />
                ) : p.url && p.type === 'VIDEO' ? (
                  <video src={p.url} controls className="aspect-video w-full bg-black" />
                ) : null}
                <CardContent className="flex flex-col gap-1 pt-3 text-sm">
                  {p.fieldKey ? (
                    <p>
                      {p.fieldKey}: <span className="font-medium">{p.fieldValue}</span>
                    </p>
                  ) : null}
                  {p.noteBody ? <p className="text-ink-700">{p.noteBody}</p> : null}
                  {p.distanceFromTaskMeters !== null ? (
                    <p className="tabular text-xs text-ink-400">{Math.round(p.distanceFromTaskMeters)} m from task</p>
                  ) : null}
                  {p.verificationFlags.map((f) => (
                    <p key={f} className="flex items-center gap-1 text-xs font-medium text-progress">
                      <AlertTriangle className="h-3 w-3" aria-hidden /> {f.replace(/_/g, ' ')}
                    </p>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {bundle.chat.length > 0 ? (
        <div>
          <h2 className="mb-3 text-[17px] font-semibold text-ink-900">Chat</h2>
          <Card>
            <CardContent className="flex flex-col gap-2 pt-6">
              {bundle.chat.map((m, i) => (
                <p key={i} className="text-sm">
                  <span className="text-ink-400">{new Date(m.createdAt).toLocaleTimeString('en-IN')}</span>{' '}
                  <span className="text-ink-700">{m.body}</span>
                </p>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Resolve</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2">
            {(['RELEASE_TO_WORKER', 'SPLIT', 'REFUND_TO_REQUESTER'] as const).map((r) => (
              <Button
                key={r}
                type="button"
                variant={resolution === r ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setResolution(r)}
              >
                {r === 'RELEASE_TO_WORKER' ? 'Release to worker' : r === 'SPLIT' ? 'Split' : 'Refund requester'}
              </Button>
            ))}
          </div>
          {resolution === 'SPLIT' ? (
            <label className="flex items-center gap-2 text-sm text-ink-700">
              Worker's share
              <Input
                type="number"
                min={0}
                max={100}
                value={workerSharePercent}
                onChange={(e) => setWorkerSharePercent(e.target.value)}
                className="w-20"
              />
              %
            </label>
          ) : null}
          <Textarea
            placeholder="Reasoning (required — becomes part of the audit record)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
          <Button disabled={notes.trim().length < 20} loading={submitting} onClick={resolve} className="w-full">
            Resolve dispute
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function PartyCard({
  label,
  party,
}: {
  label: string;
  party: { displayName: string; verificationLevel: number; priorDisputes: number; ratingAvg?: number | null };
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-6">
        <span className="text-xs uppercase tracking-wide text-ink-400">{label}</span>
        <span className="font-medium text-ink-900">{party.displayName}</span>
        <span className="text-sm text-ink-500">
          Level {party.verificationLevel}
          {party.ratingAvg != null ? ` · ${party.ratingAvg.toFixed(1)}★` : ''} · {party.priorDisputes} prior disputes
        </span>
      </CardContent>
    </Card>
  );
}
