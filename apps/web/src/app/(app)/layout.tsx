'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !user) router.replace('/sign-in');
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-50">
        <Loader2 className="h-6 w-6 animate-spin text-ink-400" aria-hidden />
      </div>
    );
  }

  return (
    <div data-surface="app" className="min-h-screen bg-paper-50">
      <header className="border-b border-line bg-paper-0">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-bold tracking-tight text-ink-900">
              OnSite
            </Link>
            <nav className="hidden items-center gap-4 sm:flex">
              <NavLink href="/dashboard" pathname={pathname}>
                Dashboard
              </NavLink>
              <NavLink href="/payments" pathname={pathname}>
                Payments
              </NavLink>
              {user.hasWorkerProfile ? (
                <>
                  <NavLink href="/feed" pathname={pathname}>
                    Feed
                  </NavLink>
                  <NavLink href="/worker/earnings" pathname={pathname}>
                    Earnings
                  </NavLink>
                </>
              ) : null}
              {user.platformRole === 'ADMIN' ? (
                <NavLink href="/admin/kyc" pathname={pathname}>
                  Admin
                </NavLink>
              ) : null}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-ink-500">{user.displayName}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await logout();
                router.push('/sign-in');
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

function NavLink({ href, pathname, children }: { href: string; pathname: string; children: React.ReactNode }) {
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        'text-sm font-medium transition-colors duration-micro ease-onsite',
        active ? 'text-brand-600' : 'text-ink-500 hover:text-ink-900',
      )}
    >
      {children}
    </Link>
  );
}
