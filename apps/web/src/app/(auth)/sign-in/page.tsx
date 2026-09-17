'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@onsite/validation';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

export default function SignInPage() {
  const { login, loginWithGoogle } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const handleGoogleToken = async (idToken: string) => {
    setFormError(null);
    try {
      await loginWithGoogle(idToken);
      router.push('/dashboard');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Google sign-in failed. Try again.');
    }
  };

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginInput) => {
    setFormError(null);
    try {
      await login(data.email, data.password);
      router.push('/dashboard');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back.</CardDescription>
      </CardHeader>
      <CardContent>
        <GoogleSignInButton onToken={handleGoogleToken} onError={setFormError} />
        <div className="my-5 flex items-center gap-3 text-xs text-ink-400">
          <div className="h-px flex-1 bg-line" />
          or continue with email
          <div className="h-px flex-1 bg-line" />
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <Field id="email" label="Email" error={errors.email?.message}>
            <Input type="email" autoComplete="email" {...register('email')} />
          </Field>
          <Field id="password" label="Password" error={errors.password?.message}>
            <Input type="password" autoComplete="current-password" {...register('password')} />
          </Field>
          {formError ? (
            <p role="alert" className="text-sm text-dispute">
              {formError}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Link href="/forgot-password" className="text-sm text-brand-600 hover:underline">
              Forgot password?
            </Link>
          </div>
          <Button type="submit" loading={isSubmitting} className="mt-2 w-full">
            Sign in
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-ink-500">
          New to OnSite?{' '}
          <Link href="/sign-up" className="font-medium text-brand-600 hover:underline">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
