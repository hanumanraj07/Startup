'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api-client';

function VerifyEmailBody() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('This verification link is missing its token.');
      return;
    }
    api
      .post('/auth/verify-email', { token })
      .then(() => setStatus('success'))
      .catch((error) => {
        setStatus('error');
        setMessage(error instanceof ApiError ? error.message : 'This link is invalid or has expired.');
      });
  }, [token]);

  if (status === 'pending') {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Verifying your email&hellip;
      </div>
    );
  }

  if (status === 'success') {
    return (
      <p className="text-sm text-verified">
        Email verified.{' '}
        <Link href="/dashboard" className="underline">
          Continue to your dashboard
        </Link>
        .
      </p>
    );
  }

  return <p className="text-sm text-dispute">{message}</p>;
}

export default function VerifyEmailPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify your email</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense fallback={null}>
          <VerifyEmailBody />
        </Suspense>
      </CardContent>
    </Card>
  );
}
