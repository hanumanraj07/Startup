'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Registers the service worker site-wide, and shows the install banner only
 * when the browser has actually decided the app is installable
 * (`beforeinstallprompt`) — never a generic "add to home screen" claim,
 * since whether that's even possible varies by browser and platform.
 */
export function PwaInstallBanner() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Dev-mode registration was a real, recurring source of stale-content
    // bugs: the service worker caches the app shell and intercepts
    // navigation, so `next dev`'s Fast Refresh can silently keep serving an
    // old bundle after an edit — indistinguishable from the edit not having
    // worked at all. Production is where offline support actually matters.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!installEvent || dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-paper-100 px-4 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-ink-900">
        <Download className="h-4 w-4 text-brand-600" aria-hidden />
        Install OnSite for quicker access and offline support.
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={async () => {
            await installEvent.prompt();
            await installEvent.userChoice;
            setInstallEvent(null);
          }}
        >
          Install
        </Button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="rounded-full p-1 text-ink-400 hover:bg-paper-100 hover:text-ink-700"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
