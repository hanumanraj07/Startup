'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@onsite/validation';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

export default function SignUpPage() {
  const { register: createAccount, loginWithGoogle } = useAuth();
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
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (data: RegisterInput) => {
    setFormError(null);
    try {
      await createAccount(data.email, data.password, data.displayName);
      router.push('/dashboard');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  };

  return (
    <Card intent="glass">
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Get someone on the ground, wherever you need them.</CardDescription>
      </CardHeader>
      <CardContent>
        <GoogleSignInButton onToken={handleGoogleToken} onError={setFormError} />
        <div className="my-5 flex items-center gap-3 text-xs text-ink-400">
          <div className="h-px flex-1 bg-line" />
          or continue with email
          <div className="h-px flex-1 bg-line" />
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <Field id="displayName" label="Full name" error={errors.displayName?.message}>
            <Input autoComplete="name" {...register('displayName')} />
          </Field>
          <Field id="email" label="Email" error={errors.email?.message}>
            <Input type="email" autoComplete="email" {...register('email')} />
          </Field>
          <Field
            id="password"
            label="Password"
            error={errors.password?.message}
            hint="At least 10 characters."
          >
            <Input type="password" autoComplete="new-password" {...register('password')} />
          </Field>
          {formError ? (
            <p role="alert" className="text-sm text-dispute">
              {formError}
            </p>
          ) : null}
          <Button type="submit" loading={isSubmitting} className="mt-2 w-full">
            Create account
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-ink-500">
          Already have an account?{' '}
          <Link href="/sign-in" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
        <p className="mt-4 text-center text-xs text-ink-300">
          By continuing you agree to OnSite&rsquo;s Terms and Privacy Policy.
        </p>
      </CardContent>
    </Card>
  );
}
