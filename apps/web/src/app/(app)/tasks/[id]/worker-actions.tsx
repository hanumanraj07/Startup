'use client';

import { useRef, useState } from 'react';
import type { TaskStatus } from '@onsite/types';
import { Loader2, Navigation, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ProofChecklist } from '@/components/ui/proof-checklist';
import type { ProofView } from '@/components/ui/proof-tile';
import { ApiError, api } from '@/lib/api-client';
import type { ProofRequirement } from '@/lib/api-types';

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition((pos) => resolve(pos), () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 8000,
    });
  });
}

export function WorkerActions({
  taskId,
  status,
  proofRequirements,
  proofs,
  onChanged,
}: {
  taskId: string;
  status: TaskStatus;
  proofRequirements: ProofRequirement[];
  proofs: ProofView[];
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'ASSIGNED') {
    return (
      <Card>
        <CardContent className="flex items-center justify-between pt-6">
          <p className="text-sm text-ink-500">Let the requester know you're on your way.</p>
          <Button loading={busy} onClick={() => run(() => api.post(`/tasks/${taskId}/en-route`))}>
            <Navigation className="h-4 w-4" aria-hidden /> Mark en route
          </Button>
          {error ? <p className="text-sm text-dispute">{error}</p> : null}
        </CardContent>
      </Card>
    );
  }

  if (status === 'WORKER_EN_ROUTE') {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <p className="text-sm text-ink-500">
            When you're at the location, confirm arrival. Your GPS position is measured against the task's exact
            address — the app never asks you to type a distance.
          </p>
          <Button
            loading={busy}
            className="self-start"
            onClick={() =>
              run(async () => {
                const pos = await getPosition();
                if (!pos) throw new ApiError(0, 'NO_LOCATION', 'Enable location access to confirm arrival.');
                await api.post(`/tasks/${taskId}/arrive`, {
                  location: {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracyMeters: pos.coords.accuracy,
                  },
                });
              })
            }
          >
            Confirm arrival
          </Button>
          {error ? <p className="text-sm text-dispute">{error}</p> : null}
        </CardContent>
      </Card>
    );
  }

  if (status === 'ARRIVED' || status === 'IN_PROGRESS') {
    const allMet = proofRequirements
      .filter((r) => r.required)
      .every(
        (r) => proofs.filter((p) => p.type === r.type && (!r.fieldKey || p.fieldKey === r.fieldKey)).length >= (r.minCount ?? 1),
      );

    return (
      <Card>
        <CardHeader>
          <CardTitle>Collect proof</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ProofChecklist requirements={proofRequirements} proofs={proofs} />

          <div className="flex flex-col gap-3 border-t border-line pt-4">
            {proofRequirements.map((req, i) => {
              const count = proofs.filter(
                (p) => p.type === req.type && (!req.fieldKey || p.fieldKey === req.fieldKey),
              ).length;
              if (count >= (req.minCount ?? 1)) return null;
              return (
                <RequirementCapture
                  key={i}
                  taskId={taskId}
                  requirement={req}
                  disabled={busy}
                  onCapture={(payload) => run(() => api.post(`/tasks/${taskId}/proofs`, payload))}
                />
              );
            })}
          </div>

          {error ? <p className="text-sm text-dispute">{error}</p> : null}

          <Button
            disabled={!allMet}
            loading={busy}
            className="w-full"
            onClick={() => run(() => api.post(`/tasks/${taskId}/submit`, {}))}
          >
            <Send className="h-4 w-4" aria-hidden /> Submit for review
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === 'SUBMITTED' || status === 'UNDER_REVIEW') {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-ink-500">
          Submitted. The requester has up to 24 hours to review before it auto-approves.
        </CardContent>
      </Card>
    );
  }

  return null;
}

function RequirementCapture({
  taskId,
  requirement,
  disabled,
  onCapture,
}: {
  taskId: string;
  requirement: ProofRequirement;
  disabled: boolean;
  onCapture: (payload: Record<string, unknown>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [text, setText] = useState('');

  if (requirement.type === 'PHOTO' || requirement.type === 'VIDEO') {
    const accept = requirement.type === 'PHOTO' ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/quicktime,video/webm';

    async function handleFile(file: File) {
      setUploading(true);
      try {
        const pos = await getPosition();
        const presign = await api.post<{ storageKey: string; uploadUrl: string }>(
          `/tasks/${taskId}/proofs/presign`,
          { type: requirement.type, contentType: file.type, sizeBytes: file.size },
        );
        await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        onCapture({
          type: requirement.type,
          storageKey: presign.storageKey,
          capturedAt: new Date().toISOString(),
          ...(pos
            ? { location: { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyMeters: pos.coords.accuracy } }
            : {}),
        });
      } finally {
        setUploading(false);
      }
    }

    return (
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={uploading}
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          Add {requirement.label.toLowerCase()}
        </Button>
        {uploading ? <Loader2 className="h-4 w-4 animate-spin text-ink-400" aria-hidden /> : null}
      </div>
    );
  }

  if (requirement.type === 'STRUCTURED_FIELD') {
    return (
      <div className="flex items-center gap-2">
        <Input
          placeholder={requirement.label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="max-w-xs"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || !text.trim()}
          onClick={() => {
            onCapture({ type: 'STRUCTURED_FIELD', fieldKey: requirement.fieldKey, fieldValue: text.trim() });
            setText('');
          }}
        >
          Save
        </Button>
      </div>
    );
  }

  if (requirement.type === 'NOTE') {
    return (
      <div className="flex flex-col gap-2">
        <Textarea
          placeholder={requirement.label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={disabled || !text.trim()}
          onClick={() => {
            onCapture({ type: 'NOTE', noteBody: text.trim() });
            setText('');
          }}
        >
          Save note
        </Button>
      </div>
    );
  }

  return <p className="text-sm text-ink-400">{requirement.label}: capture not supported yet.</p>;
}
