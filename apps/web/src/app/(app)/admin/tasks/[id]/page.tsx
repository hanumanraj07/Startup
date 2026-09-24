'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { formatPaise } from '@onsite/money';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { ApiError, api } from '@/lib/api-client';

interface AdminTaskDetail {
  id: string;
  title: string;
  description: string;
  status: string;
  categoryName: string;
  cityName: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskFlags: string[];
  createdAt: string;
  deadlineAt: string;
  location: { latitude: number; longitude: number; address: string };
  money: { budgetPaise: number; commissionPaise: number; workerPayoutPaise: number };
  payment: { status: string; amountPaise: number } | null;
  requester: { id: string; displayName: string; verificationLevel: number };
  assignedWorker: {
    id: string;
    displayName: string;
    verificationLevel: number;
    ratingAvg: number | null;
    completionRate: number | null;
  } | null;
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
  statusHistory: { toStatus: string; actorRole: string; reason: string | null; createdAt: string }[];
  disputes: { id: string; status: string }[];
}

const RISK_TONE: Record<AdminTaskDetail['riskLevel'], string> = {
  LOW: 'bg-paper-100 text-ink-500',
  MEDIUM: 'bg-progress/10 text-progress',
  HIGH: 'bg-dispute/10 text-dispute',
};

export default function AdminTaskDetailPage() {
  const params = useParams<{ id: string }>();
  const [task, setTask] = useState<AdminTaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AdminTaskDetail>(`/admin/tasks/${params.id}`)
      .then(setTask)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this task.'));
  }, [params.id]);

  if (error) return <p className="text-sm text-dispute">{error}</p>;
  if (!task) {
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
          <div className="flex items-center gap-2">
            <StatusPill status={task.status as never} />
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RISK_TONE[task.riskLevel]}`}>
              {task.riskLevel.toLowerCase()} risk
            </span>
          </div>
          <CardTitle>{task.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          <p className="text-sm text-ink-500">
            {task.categoryName} · {task.cityName} · {task.location.address}
          </p>
          <p className="text-sm text-ink-700">{task.description}</p>
          {task.riskFlags.map((f) => (
            <p key={f} className="flex items-center gap-1 text-xs font-medium text-progress">
              <AlertTriangle className="h-3 w-3" aria-hidden /> {f.replace(/_/g, ' ')}
            </p>
          ))}
          {task.disputes.length > 0 ? (
            <div className="flex flex-col gap-1 pt-2">
              {task.disputes.map((d) => (
                <Link key={d.id} href={`/admin/disputes/${d.id}`} className="text-sm text-brand-600 hover:underline">
                  View dispute ({d.status.toLowerCase()})
                </Link>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <PartyCard label="Requester" party={task.requester} />
        {task.assignedWorker ? <PartyCard label="Worker" party={task.assignedWorker} /> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Money</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0 text-sm">
          <Row label="Budget" value={formatPaise(task.money.budgetPaise)} />
          <Row label="Commission" value={formatPaise(task.money.commissionPaise)} />
          <Row label="Worker payout" value={formatPaise(task.money.workerPayoutPaise)} />
          {task.payment ? (
            <Row label="Payment status" value={task.payment.status.toLowerCase()} />
          ) : (
            <Row label="Payment status" value="not funded" />
          )}
        </CardContent>
      </Card>

      {task.proofs.length > 0 ? (
        <div>
          <h2 className="mb-3 text-[17px] font-semibold text-ink-900">Evidence</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {task.proofs.map((p, i) => (
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

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          {task.statusHistory.map((h, i) => (
            <div key={i} className="flex flex-col gap-0.5 text-sm">
              <span className="font-medium text-ink-900">{h.toStatus.replace(/_/g, ' ').toLowerCase()}</span>
              <span className="tabular text-xs text-ink-400">
                {new Date(h.createdAt).toLocaleString('en-IN')} · {h.actorRole.toLowerCase()}
              </span>
              {h.reason ? <span className="text-xs text-ink-500">{h.reason}</span> : null}
            </div>
          ))}
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
  party: { displayName: string; verificationLevel: number; ratingAvg?: number | null; completionRate?: number | null };
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-6">
        <span className="text-xs uppercase tracking-wide text-ink-400">{label}</span>
        <span className="font-medium text-ink-900">{party.displayName}</span>
        <span className="text-sm text-ink-500">
          Level {party.verificationLevel}
          {party.ratingAvg != null ? ` · ${party.ratingAvg.toFixed(1)}★` : ''}
          {party.completionRate != null ? ` · ${Math.round(party.completionRate)}% completion` : ''}
        </span>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500">{label}</span>
      <span className="tabular font-medium text-ink-900">{value}</span>
    </div>
  );
}
