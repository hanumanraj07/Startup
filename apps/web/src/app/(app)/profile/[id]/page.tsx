'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { PublicUser, PublicWorker } from '@onsite/types';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrustBadge } from '@/components/ui/trust-badge';
import { ApiError, api } from '@/lib/api-client';

function isWorkerProfile(profile: PublicUser | PublicWorker): profile is PublicWorker {
  return 'ratingAvg' in profile;
}

export default function PublicProfilePage() {
  const params = useParams<{ id: string }>();
  const [profile, setProfile] = useState<PublicUser | PublicWorker | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PublicUser | PublicWorker>(`/users/${params.id}/public`)
      .then(setProfile)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this profile.'));
  }, [params.id]);

  if (error) return <p className="text-sm text-dispute">{error}</p>;
  if (!profile) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <div className="flex items-center gap-4 rounded-card bg-hero-gradient p-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex items-center gap-4 rounded-card bg-hero-gradient p-4">
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, non-Next-optimizable avatar URL
          <img src={profile.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-paper-0 text-xl font-semibold text-ink-500">
            {profile.displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-ink-900">{profile.displayName}</h1>
          {profile.homeCity ? <p className="text-sm text-ink-500">{profile.homeCity}</p> : null}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isWorkerProfile(profile) ? (
            <TrustBadge worker={profile} />
          ) : (
            <p className="text-sm text-ink-500">
              Member since{' '}
              {new Date(profile.memberSince).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} &middot;
              verification level {profile.verificationLevel} of 5
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
