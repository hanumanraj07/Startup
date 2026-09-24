'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/kyc', label: 'KYC queue' },
  { href: '/admin/disputes', label: 'Disputes' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/tasks', label: 'Tasks' },
  { href: '/admin/categories', label: 'Categories & cities' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();

  // The real gate is server-side (AdminGuard on every /admin/* route) — this
  // is only so a non-admin doesn't see a broken console full of 403s.
  if (user && user.platformRole !== 'ADMIN') {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <p className="text-ink-500">You don't have access to the admin console.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-ink-900">Admin</h1>
        <nav className="mt-4 flex gap-1 border-b border-line">
          {TABS.map((tab) => {
            // '/admin' would startsWith-match every admin route, so the
            // dashboard tab needs an exact match; the rest are subtrees.
            const active = tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'border-b-2 px-3 pb-3 text-sm font-medium transition-colors duration-micro ease-onsite',
                  active ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-500 hover:text-ink-900',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
