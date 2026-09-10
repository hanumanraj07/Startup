import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper-50 px-4 py-12">
      <Link href="/" className="mb-8 text-xl font-bold tracking-tight text-ink-900">
        OnSite
      </Link>
      <main className="w-full max-w-[400px]">{children}</main>
    </div>
  );
}
