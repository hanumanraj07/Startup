'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2, MapPin } from 'lucide-react';
import type { TaskStatus } from '@onsite/types';
import { formatPaise } from '@onsite/money';
import { Card, CardContent } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { MoneyBreakdown } from '@/components/ui/money-breakdown';
import type { ProofView } from '@/components/ui/proof-tile';
import { ApiError, api } from '@/lib/api-client';
import type { ProofRequirement } from '@/lib/api-types';
import { useTaskSocket } from '@/lib/use-task-socket';
import { WorkerActions } from './worker-actions';
import { RequesterActions } from './requester-actions';
import { ChatPanel } from './chat-panel';
import { ReportIssueDialog } from './report-issue-dialog';

/** Chat history is visible for a task's whole life once a worker was assigned. */
const CHAT_VISIBLE_STATUSES: TaskStatus[] = [
  'ASSIGNED',
  'WORKER_EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'COMPLETED',
  'PAYMENT_RELEASED',
  'DISPUTED',
];

/** New messages are only accepted in these — mirrors the backend's CHAT_WRITABLE_STATUSES exactly. */
const CHAT_WRITABLE_STATUSES: TaskStatus[] = [
  'ASSIGNED',
  'WORKER_EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
];

/** Mirrors the backend's DISPUTABLE_STATUSES exactly — see transitions.ts. */
const REPORTABLE_STATUSES: TaskStatus[] = [
  'ASSIGNED',
  'WORKER_EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'COMPLETED',
];

interface StatusEvent {
  status: TaskStatus;
  at: string;
  actorRole: 'REQUESTER' | 'WORKER' | 'ADMIN' | 'SYSTEM';
  reason: string | null;
}

interface TaskBase {
  id: string;
  title: string;
  description: string;
  categoryName: string;
  status: TaskStatus;
  deadlineAt: string;
  proofRequirements: ProofRequirement[];
  statusHistory: StatusEvent[];
  location: { latitude: number; longitude: number; address: string };
}

interface OwnerTask extends TaskBase {
  money: { budgetPaise: number; commissionPaise: number; workerPayoutPaise: number };
  assignedWorker: { id: string; displayName: string; ratingAvg: number | null; tasksCompleted: number } | null;
}

interface WorkerTask extends TaskBase {
  payoutPaise: number;
  requester: { displayName: string; verificationLevel: number };
}

type TaskDetail = OwnerTask | WorkerTask;

function isOwnerView(task: TaskDetail): task is OwnerTask {
  return 'money' in task;
}

/** Proofs exist, or can be added, from ARRIVED onward. */
const PROOF_VISIBLE_STATUSES: TaskStatus[] = [
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'COMPLETED',
  'PAYMENT_RELEASED',
  'DISPUTED',
];

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [proofs, setProofs] = useState<ProofView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const t = await api.get<TaskDetail>(`/tasks/${params.id}`);
    setTask(t);
    if (PROOF_VISIBLE_STATUSES.includes(t.status)) {
      const { data } = await api.get<{ data: ProofView[] }>(`/tasks/${params.id}/proofs`);
      setProofs(data);
    } else {
      setProofs([]);
    }
  }, [params.id]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this task.'));
  }, [load]);

  // The live task timeline: a status change from the other party (worker
  // marking en route, requester approving) reaches this page over the
  // socket instead of waiting for a manual refresh.
  useTaskSocket(task?.id, {
    onStatus: () => {
      load().catch(() => undefined);
    },
  });

  if (error) return <p className="text-sm text-dispute">{error}</p>;
  if (!task) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading&hellip;
      </div>
    );
  }

  const owner = isOwnerView(task);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <StatusPill status={task.status} />
          <span className="text-sm text-ink-400">{task.categoryName}</span>
        </div>
        <h1 className="text-[28px] font-bold tracking-tight text-ink-900">{task.title}</h1>
        <p className="flex items-center gap-1.5 text-sm text-ink-500">
          <MapPin className="h-4 w-4" aria-hidden /> {task.location.address}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="whitespace-pre-wrap text-[15px] text-ink-700">{task.description}</p>
        </CardContent>
      </Card>

      {owner ? (
        <MoneyBreakdown {...task.money} />
      ) : (
        <div className="rounded-card border border-line bg-paper-100 p-4">
          <div className="flex items-center justify-between text-[15px]">
            <span className="text-ink-900">You receive</span>
            <span className="tabular font-semibold text-verified">{formatPaise(task.payoutPaise)}</span>
          </div>
        </div>
      )}

      {owner && task.assignedWorker ? (
        <Link href={`/profile/${task.assignedWorker.id}`}>
          <Card className="transition-colors duration-micro ease-onsite hover:bg-paper-100">
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <p className="font-medium text-ink-900">{task.assignedWorker.displayName}</p>
                <p className="text-sm text-ink-500">{task.assignedWorker.tasksCompleted} tasks completed</p>
              </div>
              {task.assignedWorker.ratingAvg !== null ? (
                <span className="tabular text-sm font-semibold text-ink-900">
                  {task.assignedWorker.ratingAvg.toFixed(1)} ★
                </span>
              ) : null}
            </CardContent>
          </Card>
        </Link>
      ) : null}

      {!owner ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-ink-500">Posted by</p>
            <p className="font-medium text-ink-900">{task.requester.displayName}</p>
          </CardContent>
        </Card>
      ) : null}

      {!owner ? (
        <WorkerActions
          taskId={task.id}
          status={task.status}
          proofRequirements={task.proofRequirements}
          proofs={proofs}
          onChanged={load}
        />
      ) : (
        <RequesterActions taskId={task.id} status={task.status} proofs={proofs} onChanged={load} />
      )}

      {CHAT_VISIBLE_STATUSES.includes(task.status) ? (
        <ChatPanel taskId={task.id} closed={!CHAT_WRITABLE_STATUSES.includes(task.status)} />
      ) : null}

      {REPORTABLE_STATUSES.includes(task.status) ? <ReportIssueDialog taskId={task.id} onReported={load} /> : null}

      <div>
        <h2 className="mb-3 text-[19px] font-semibold text-ink-900">Timeline</h2>
        <ol className="flex flex-col gap-4 border-l border-line pl-4">
          {task.statusHistory.map((event, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-600" aria-hidden />
              <p className="text-sm font-medium text-ink-900">
                <StatusPill status={event.status} />
              </p>
              <p className="mt-1 text-xs text-ink-400">
                {new Date(event.at).toLocaleString('en-IN')} &middot; {event.actorRole.toLowerCase()}
              </p>
              {event.reason ? <p className="mt-1 text-sm text-ink-500">{event.reason}</p> : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
