'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { TaskStatus } from '@onsite/types';
import { formatPaise } from '@onsite/money';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

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
        <Tabs value={perspective} onValueChange={(v) => setPerspective(v as Perspective)}>
          <TabsList>
            <TabsTrigger value="requester">Posted by me</TabsTrigger>
            <TabsTrigger value="worker">I&rsquo;m working on</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      {error ? <p className="text-sm text-dispute">{error}</p> : null}

      {!tasks ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-3 w-14" />
                </div>
              </CardContent>
            </Card>
          ))}
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
