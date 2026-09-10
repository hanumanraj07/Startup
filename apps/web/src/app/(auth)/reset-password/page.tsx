'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema } from '@onsite/validation';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api-client';

type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token },
  });

  const onSubmit = async (data: ResetPasswordInput) => {
    setFormError(null);
    try {
      await api.post('/auth/password/reset', data);
      setDone(true);
      setTimeout(() => router.push('/sign-in'), 2000);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'That reset link is invalid or has expired.');
    }
  };

  if (!token) {
    return (
      <p className="text-sm text-dispute">
        This reset link is missing its token.{' '}
        <Link href="/forgot-password" className="underline">
          Request a new one
        </Link>
        .
      </p>
    );
  }

  if (done) {
    return <p className="text-sm text-verified">Password updated. Redirecting you to sign in&hellip;</p>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <input type="hidden" {...register('token')} />
      <Field id="password" label="New password" error={errors.password?.message} hint="At least 10 characters.">
        <Input type="password" autoComplete="new-password" {...register('password')} />
      </Field>
      {formError ? (
        <p role="alert" className="text-sm text-dispute">
          {formError}
        </p>
      ) : null}
      <Button type="submit" loading={isSubmitting} className="mt-2 w-full">
        Update password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>Choose something you haven't used before.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
