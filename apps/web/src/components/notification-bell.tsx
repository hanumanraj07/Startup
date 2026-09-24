'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api-client';

interface NotificationItem {
  readAt: string | null;
}

/**
 * No push channel tells the client "you have a new notification" — see
 * ai/memory.md — so this polls. 30s is a deliberate compromise: frequent
 * enough that a badge feels roughly live, infrequent enough not to matter
 * against docs/07's per-user rate limits even with many tabs open.
 */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      api
        .get<{ data: NotificationItem[] }>('/notifications?limit=50')
        .then((res) => {
          if (!cancelled) setUnread(res.data.filter((n) => !n.readAt).length);
        })
        .catch(() => undefined);
    }
    poll();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') poll();
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Link href="/notifications" className="relative inline-flex" aria-label="Notifications">
      <Bell className="h-5 w-5 text-ink-500 hover:text-ink-900" aria-hidden />
      {unread > 0 ? (
        // Same one-shot spring pop-in as StatusPill's "verified" tone — a new
        // unread count is a "this just changed" moment, not an ongoing state,
        // so it doesn't loop.
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 14 }}
          className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-dispute px-1 text-[10px] font-semibold text-white"
        >
          {unread > 9 ? '9+' : unread}
        </motion.span>
      ) : null}
    </Link>
  );
}
