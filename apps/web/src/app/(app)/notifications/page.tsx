'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { toast } from '@/lib/use-toast';
import { cn } from '@/lib/utils';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return api
      .get<{ data: NotificationItem[] }>('/notifications?limit=50')
      .then((res) => setItems(res.data))
      .catch(() => setError('Could not load notifications.'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAllRead() {
    await api.post('/notifications/read', {});
    await load();
    toast({ title: 'All notifications marked read', variant: 'success' });
  }

  const unreadCount = items?.filter((n) => !n.readAt).length ?? 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[32px] font-bold tracking-tight text-ink-900">Notifications</h1>
        {unreadCount > 0 ? (
          <Button variant="secondary" size="sm" onClick={markAllRead}>
            Mark all read
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-dispute">{error}</p> : null}

      {!items ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="flex flex-col gap-2 py-4">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Bell} title="Nothing yet" description="Updates on your tasks will show up here." />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((n) => (
            <Card
              key={n.id}
              className={cn(
                'transition-all duration-base ease-onsite hover:-translate-y-0.5 hover:shadow-float',
                !n.readAt && 'border-brand-600',
              )}
            >
              <CardContent className="flex flex-col gap-1 py-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-ink-900">{n.title}</span>
                  <span className="whitespace-nowrap text-xs text-ink-400">
                    {new Date(n.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-sm text-ink-500">{n.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
