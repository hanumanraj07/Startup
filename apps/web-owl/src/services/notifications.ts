import { api } from '@/services/api';
import { store } from '@/store/store';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export function countUnread(items: NotificationItem[]): number {
  return items.filter((n) => !n.readAt).length;
}

/**
 * No push channel tells the client "you have a new notification" (see
 * ai/memory.md), so the bell polls this. Failures are silent: a badge that
 * does not update is better than an error toast every 30 seconds.
 */
export async function refreshUnread(): Promise<void> {
  try {
    const res = await api.get<{ data: NotificationItem[] }>('/notifications?limit=50');
    store.unreadNotifications = countUnread(res.data);
  } catch {
    // keep the last known count
  }
}
