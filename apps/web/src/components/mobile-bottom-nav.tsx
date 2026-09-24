'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ListChecks, Search, Settings, Wallet, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

/**
 * The (app) shell's only navigation below the `sm` breakpoint — the desktop
 * header nav is `hidden sm:flex` with no prior mobile fallback, despite
 * OnSite being explicitly one-handed-mobile-first (docs/19). Coexists with
 * the header purely via breakpoint split: this is `sm:hidden`, the header
 * nav is `hidden sm:flex`, so there's no overlap.
 *
 * Notifications intentionally stays only in the header bell, not duplicated
 * here, so there's one unread-count surface, not two.
 */
const ITEMS: { href: string; label: string; icon: LucideIcon; workerOnly?: boolean }[] = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/tasks', label: 'My tasks', icon: ListChecks },
  { href: '/feed', label: 'Feed', icon: Search, workerOnly: true },
  { href: '/payments', label: 'Payments', icon: Wallet },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function MobileBottomNav() {
  const { user } = useAuth();
  const pathname = usePathname();

  if (!user) return null;

  const items = ITEMS.filter((item) => !item.workerOnly || user.hasWorkerProfile);

  return (
    <nav
      className="glass-panel fixed inset-x-0 bottom-0 z-40 grid border-t sm:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      aria-label="Primary"
    >
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex min-h-[var(--tap-min,48px)] flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium',
              'transition-colors duration-micro ease-onsite',
              active ? 'text-brand-600' : 'text-ink-500',
            )}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
