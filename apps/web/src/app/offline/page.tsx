import { WifiOff } from 'lucide-react';

export const metadata = { title: "You're offline" };

/**
 * Served by the service worker (public/sw.js) when a navigation request
 * fails with no network. Deliberately static — no data fetching, no auth
 * check — since the entire point is that it must render with nothing but
 * what was cached at install time.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper-50 px-6 text-center">
      <WifiOff className="h-10 w-10 text-ink-300" aria-hidden />
      <div>
        <h1 className="text-[19px] font-semibold text-ink-900">You&rsquo;re offline</h1>
        <p className="mt-1 max-w-xs text-sm text-ink-500">
          OnSite needs a connection for live task data. Reconnect and reload to continue.
        </p>
      </div>
    </div>
  );
}
