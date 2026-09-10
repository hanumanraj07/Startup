'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCircle2, CircleDashed } from 'lucide-react';
import { phoneSchema, verifyOtpSchema } from '@onsite/validation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { currentPushSubscription, pushSupported, subscribeToPush } from '@/lib/push';

export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-bold tracking-tight text-ink-900">Welcome, {user.displayName}</h1>
        <p className="mt-1 text-ink-500">
          Verification level {user.verificationLevel} of 5 &middot; member since{' '}
          {new Date(user.memberSince).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Post a task</CardTitle>
            <CardDescription>Get a verified local person to inspect, verify or collect something.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/tasks/new">Create a task</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{user.hasWorkerProfile ? 'Find work nearby' : 'Become a worker'}</CardTitle>
            <CardDescription>
              {user.hasWorkerProfile
                ? 'Browse tasks near your base location and start earning.'
                : 'Set up your worker profile to start accepting tasks.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="secondary" asChild>
              <Link href={user.hasWorkerProfile ? '/feed' : '/worker/onboarding'}>
                {user.hasWorkerProfile ? 'Browse the feed' : 'Get started'}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account status</CardTitle>
          <CardDescription>Both email and phone are required to reach verification level 1 — the minimum to post or accept any task.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <StatusRow verified={user.emailVerified} label="Email verified" />
          {!user.emailVerified ? (
            <p className="pl-6 text-sm text-ink-400">
              Check your inbox for the link sent when you signed up.
            </p>
          ) : null}

          <StatusRow verified={user.phoneVerified} label="Phone verified" />
          {!user.phoneVerified ? <PhoneVerification /> : null}

          {user.hasWorkerProfile ? (
            <div className="flex items-center justify-between border-t border-line pt-4">
              <div>
                <p className="text-sm font-medium text-ink-900">Identity verification (level {user.verificationLevel}/5)</p>
                <p className="text-sm text-ink-400">Required to accept tasks above ₹1,000.</p>
              </div>
              <Button variant="secondary" size="sm" asChild>
                <Link href="/kyc">Get verified</Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <NotificationsCard />
    </div>
  );
}

function NotificationsCard() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(pushSupported());
    currentPushSubscription().then((sub) => setSubscribed(sub !== null));
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const ok = await subscribeToPush();
      if (ok) setSubscribed(true);
      else setError('Notification permission was not granted.');
    } catch {
      setError('Could not enable notifications on this device.');
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <Card>
      <CardContent className="flex items-center justify-between pt-6">
        <span className="flex items-center gap-2 text-sm text-ink-700">
          <Bell className="h-4 w-4 text-ink-400" aria-hidden />
          {subscribed ? 'Push notifications are on for this device.' : 'Get notified when something needs your attention.'}
        </span>
        {!subscribed ? (
          <Button variant="secondary" size="sm" loading={busy} onClick={enable}>
            Enable notifications
          </Button>
        ) : null}
      </CardContent>
      {error ? <CardContent className="pt-0 text-sm text-dispute">{error}</CardContent> : null}
    </Card>
  );
}

function StatusRow({ verified, label }: { verified: boolean; label: string }) {
  const Icon = verified ? CheckCircle2 : CircleDashed;
  return (
    <div className={`flex items-center gap-2 text-sm ${verified ? 'text-verified' : 'text-ink-400'}`}>
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </div>
  );
}

function PhoneVerification() {
  const { refetchUser } = useAuth();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setError(null);
    const parsed = phoneSchema.safeParse(phone);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid phone number.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/phone/send-otp', { phone: parsed.data });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send a code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError(null);
    const parsed = verifyOtpSchema.safeParse({ phone, code });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/phone/verify-otp', parsed.data);
      await refetchUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That code is incorrect or has expired.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 pl-6">
      {!sent ? (
        <div className="flex gap-2">
          <Input
            type="tel"
            placeholder="+91XXXXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="max-w-[220px]"
          />
          <Button type="button" size="sm" variant="secondary" loading={busy} onClick={sendCode}>
            Send code
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            inputMode="numeric"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="max-w-[140px]"
          />
          <Button type="button" size="sm" loading={busy} onClick={verifyCode}>
            Verify
          </Button>
        </div>
      )}
      {error ? <p className="text-sm text-dispute">{error}</p> : null}
    </div>
  );
}
