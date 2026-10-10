/**
 * Registers the service worker, in production only. In dev the worker caches
 * static files and would keep serving an old bundle after an edit, which is
 * indistinguishable from the edit not having worked at all; offline support
 * only matters in production anyway. (Same rule as apps/web.)
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

/** The browser's install prompt event, which is not in lib.dom. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
