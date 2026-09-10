'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/ui/empty-state';
import { TaskCard, type FeedTask } from '@/components/ui/task-card';
import { ApiError, api } from '@/lib/api-client';
import type { CategoryView } from '@/lib/api-types';
import { useAuth } from '@/lib/auth-context';

interface WorkerProfile {
  id: string;
  baseLocation: { latitude: number; longitude: number };
  baseCity: string;
  workingRadiusMeters: number;
  isAvailable: boolean;
  categories: { slug: string; name: string }[];
}

type RawFeedItem = Omit<FeedTask, 'categoryIcon'>;

export default function FeedPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState<WorkerProfile | null>(null);
  const [tasks, setTasks] = useState<FeedTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadFeed = useCallback(async (p: WorkerProfile) => {
    const [{ data: categories }, { data: items }] = await Promise.all([
      api.get<{ data: CategoryView[] }>('/categories'),
      api.get<{ data: RawFeedItem[] }>(
        `/tasks/nearby?latitude=${p.baseLocation.latitude}&longitude=${p.baseLocation.longitude}&radiusMeters=${p.workingRadiusMeters}&limit=20`,
      ),
    ]);
    const iconBySlug = new Map<string, string>(categories.map((c) => [c.slug, c.icon]));
    setTasks(items.map((t) => ({ ...t, categoryIcon: iconBySlug.get(t.categorySlug) ?? '' })));
  }, []);

  useEffect(() => {
    api
      .get<WorkerProfile>('/workers/me')
      .then(async (p) => {
        setProfile(p);
        await loadFeed(p);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          router.replace('/worker/onboarding');
          return;
        }
        setError('Could not load your worker profile.');
      });
  }, [loadFeed, router]);

  async function toggleAvailability(isAvailable: boolean) {
    if (!profile) return;
    const previous = profile;
    setProfile({ ...profile, isAvailable });
    try {
      await api.patch('/workers/me/availability', { isAvailable });
    } catch {
      setProfile(previous);
    }
  }

  async function accept(taskId: string) {
    setAcceptingId(taskId);
    setActionError(null);
    try {
      await api.post(`/tasks/${taskId}/accept`);
      router.push(`/tasks/${taskId}`);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Could not accept this task. It may have just been taken.',
      );
      if (profile) await loadFeed(profile);
    } finally {
      setAcceptingId(null);
    }
  }

  if (error) return <p className="text-sm text-dispute">{error}</p>;

  if (!profile) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading&hellip;
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[32px] font-bold tracking-tight text-ink-900">Nearby tasks</h1>
          <p className="mt-1 text-sm text-ink-500">
            Within {(profile.workingRadiusMeters / 1000).toFixed(0)} km of {profile.baseCity}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          {profile.isAvailable ? 'Available' : 'Offline'}
          <Switch checked={profile.isAvailable} onCheckedChange={toggleAvailability} />
        </label>
      </div>

      {user && user.verificationLevel < 1 ? (
        <div className="flex items-start gap-2 rounded-card border border-progress/30 bg-progress/10 p-3 text-sm text-ink-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-progress" aria-hidden />
          <span>
            Verify your email and phone to accept tasks — every task requires at least verification level 1, so
            none will appear here until you do.{' '}
            <Link href="/dashboard" className="font-medium text-brand-600 hover:underline">
              Verify now
            </Link>
          </span>
        </div>
      ) : null}

      {actionError ? <p className="text-sm text-dispute">{actionError}</p> : null}

      {!profile.isAvailable ? (
        <EmptyState
          title="You're offline"
          description="Turn availability on to see and accept nearby tasks."
        />
      ) : !tasks ? (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading tasks&hellip;
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState title="Nothing nearby right now" description="New tasks in your categories will show up here." />
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} onAccept={accept} accepting={acceptingId === t.id} />
          ))}
        </div>
      )}
    </div>
  );
}
