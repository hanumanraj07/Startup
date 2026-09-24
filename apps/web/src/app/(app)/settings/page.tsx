'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApiError, api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { toast } from '@/lib/use-toast';

interface WorkerSettings {
  workingRadiusMeters: number;
  baseCity: string;
}

export default function SettingsPage() {
  const { user, logout, refetchUser } = useAuth();
  const router = useRouter();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [worker, setWorker] = useState<WorkerSettings | null>(null);
  const [radiusKm, setRadiusKm] = useState(10);
  const [savingRadius, setSavingRadius] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.hasWorkerProfile) return;
    api.get<WorkerSettings>('/workers/me').then((w) => {
      setWorker(w);
      setRadiusKm(Math.round(w.workingRadiusMeters / 1000));
    });
  }, [user?.hasWorkerProfile]);

  async function saveProfile() {
    setSavingProfile(true);
    setProfileError(null);
    try {
      await api.patch('/users/me', { displayName: displayName.trim() });
      await refetchUser();
      toast({ title: 'Profile saved', variant: 'success' });
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Could not save your name.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveRadius() {
    setSavingRadius(true);
    try {
      await api.patch('/workers/me', { workingRadiusMeters: radiusKm * 1000 });
      toast({ title: 'Working radius saved', variant: 'success' });
    } finally {
      setSavingRadius(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete('/users/me', { confirm: confirmText, password: password || undefined });
      await logout();
      router.push('/sign-in');
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete your account.');
      setDeleting(false);
    }
  }

  if (!user) return null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-[32px] font-bold tracking-tight text-ink-900">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field id="displayName" label="Display name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
          </Field>
          {profileError ? <p className="text-sm text-dispute">{profileError}</p> : null}
          <Button
            className="self-start"
            size="sm"
            onClick={saveProfile}
            loading={savingProfile}
            disabled={displayName.trim().length < 2}
          >
            Save
          </Button>
        </CardContent>
      </Card>

      {user.hasWorkerProfile ? (
        <Card>
          <CardHeader>
            <CardTitle>Worker settings</CardTitle>
            <CardDescription>
              How far you&rsquo;re willing to travel from {worker?.baseCity ?? 'your base location'} for a task.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {!worker ? (
              <div className="flex items-center gap-2 text-sm text-ink-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading&hellip;
              </div>
            ) : (
              <>
                <Field id="radius" label={`Working radius: ${radiusKm} km`}>
                  <input
                    id="radius"
                    type="range"
                    min={1}
                    max={50}
                    value={radiusKm}
                    onChange={(e) => setRadiusKm(Number(e.target.value))}
                    className="w-full accent-brand-600"
                  />
                </Field>
                <p className="text-xs text-ink-400">
                  Wider covers more tasks but means more travel. Most workers do well between 10&ndash;20 km.
                </p>
                <Button className="self-start" size="sm" onClick={saveRadius} loading={savingRadius}>
                  Save
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-dispute/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-dispute">
            <TriangleAlert className="h-5 w-5" aria-hidden /> Danger zone
          </CardTitle>
          <CardDescription>Permanently delete your account. This cannot be undone.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            Delete my account
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            setConfirmText('');
            setPassword('');
            setDeleteError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Your name, email, and phone number are permanently erased. Task and payment history is kept
              (anonymized) since other people&rsquo;s records depend on it. This cannot be undone. If you have any
              task still in progress, finish or cancel it first.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field id="confirmDelete" label='Type "DELETE" to confirm'>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </Field>
            <Field id="deletePassword" label="Password (leave blank if you use Google sign-in)">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {deleteError ? <p className="text-sm text-dispute">{deleteError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteAccount} loading={deleting} disabled={confirmText !== 'DELETE'}>
              Permanently delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
