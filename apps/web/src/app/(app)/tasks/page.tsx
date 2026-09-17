'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import type { TaskStatus } from '@onsite/types';
import { formatPaise } from '@onsite/money';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

interface TaskListItem {
  id: string;
  title: string;
  categorySlug: string;
  status: TaskStatus;
  budgetPaise: number;
  deadlineAt: string;
  createdAt: string;
}

type Perspective = 'requester' | 'worker';

/**
 * Previously the only way to reach a task's detail page was the moment
 * right after posting or accepting it — there was no standalone list. Found
 * live: a founder testing the product had no way back to a task once they
 * navigated away. Polls lightly while visible for the same reason the feed
 * page does (see its own comment) — task:status pushes cover the task detail
 * page itself, but this list has no equivalent push channel yet.
 */
export default function MyTasksPage() {
  const { user } = useAuth();
  const [perspective, setPerspective] = useState<Perspective>('requester');
  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((p: Perspective) => {
    return api
      .get<{ data: TaskListItem[] }>(`/tasks/mine?perspective=${p}&limit=50`)
      .then((res) => setTasks(res.data))
      .catch(() => setError('Could not load your tasks.'));
  }, []);

  useEffect(() => {
    setTasks(null);
    void load(perspective);
  }, [perspective, load]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load(perspective);
    }, 20_000);
    return () => clearInterval(interval);
  }, [perspective, load]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[32px] font-bold tracking-tight text-ink-900">My tasks</h1>
          <p className="mt-1 text-sm text-ink-500">Everything you&rsquo;ve posted or accepted, in one place.</p>
        </div>
        <Button asChild size="sm">
          <Link href="/tasks/new">Post a task</Link>
        </Button>
      </div>

      {user?.hasWorkerProfile ? (
        <div className="flex gap-2 border-b border-line">
          <TabButton active={perspective === 'requester'} onClick={() => setPerspective('requester')}>
            Posted by me
          </TabButton>
          <TabButton active={perspective === 'worker'} onClick={() => setPerspective('worker')}>
            I&rsquo;m working on
          </TabButton>
        </div>
      ) : null}

      {error ? <p className="text-sm text-dispute">{error}</p> : null}

      {!tasks ? (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading&hellip;
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          title={perspective === 'requester' ? 'Nothing posted yet' : 'Nothing accepted yet'}
          description={
            perspective === 'requester'
              ? 'Post your first task to get started.'
              : 'Tasks you accept from the feed will show up here.'
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((t) => (
            <Link key={t.id} href={`/tasks/${t.id}`}>
              <Card className="transition-colors duration-micro ease-onsite hover:bg-paper-100">
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-ink-900">{t.title}</span>
                    <span className="text-sm text-ink-500">
                      Due {new Date(t.deadlineAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusPill status={t.status} />
                    <span className="tabular text-sm text-ink-500">{formatPaise(t.budgetPaise)}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors duration-micro ease-onsite',
        active ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-500 hover:text-ink-900',
      )}
    >
      {children}
    </button>
  );
}
