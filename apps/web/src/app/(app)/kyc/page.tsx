'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Upload, XCircle } from 'lucide-react';
import type { KycStatus } from '@onsite/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api-client';

interface KycStatusResponse {
  status: KycStatus | 'NONE';
  rejectionReason?: string | null;
  submittedAt?: string;
}

const DOCUMENT_TYPES = [
  { value: 'AADHAAR', label: 'Aadhaar' },
  { value: 'PAN', label: 'PAN card' },
  { value: 'DRIVING_LICENCE', label: 'Driving licence' },
  { value: 'VOTER_ID', label: 'Voter ID' },
  { value: 'PASSPORT', label: 'Passport' },
] as const;

export default function KycPage() {
  const [status, setStatus] = useState<KycStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<KycStatusResponse>('/users/me/kyc')
      .then(setStatus)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load your verification status.'));
  }, []);

  if (error) return <p className="text-sm text-dispute">{error}</p>;
  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading&hellip;
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-bold tracking-tight text-ink-900">Identity verification</h1>
        <p className="mt-1 text-ink-500">
          Government ID and a selfie, admin approved — required to accept tasks above ₹1,000 (verification level 2).
        </p>
      </div>

      {status.status === 'PENDING' ? (
        <StatusCard
          icon={Clock}
          tone="text-progress"
          title="Under review"
          description="We'll notify you once it's been checked. This usually takes under a day."
        />
      ) : status.status === 'APPROVED' ? (
        <StatusCard icon={CheckCircle2} tone="text-verified" title="Verified" description="You can accept tasks up to ₹5,000." />
      ) : (
        <>
          {status.status === 'REJECTED' ? (
            <StatusCard
              icon={XCircle}
              tone="text-dispute"
              title="Submission rejected"
              description={status.rejectionReason ?? 'Please resubmit with clearer documents.'}
            />
          ) : null}
          <KycForm onSubmitted={() => setStatus({ status: 'PENDING' })} />
        </>
      )}
    </div>
  );
}

function StatusCard({
  icon: Icon,
  tone,
  title,
  description,
}: {
  icon: typeof Clock;
  tone: string;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 pt-6">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone}`} aria-hidden />
        <div>
          <p className="font-medium text-ink-900">{title}</p>
          <p className="mt-1 text-sm text-ink-500">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function KycForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [documentType, setDocumentType] = useState<(typeof DOCUMENT_TYPES)[number]['value']>('AADHAAR');
  const [documentNumber, setDocumentNumber] = useState('');
  const [frontKey, setFrontKey] = useState<string | null>(null);
  const [backKey, setBackKey] = useState<string | null>(null);
  const [selfieKey, setSelfieKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = documentNumber.trim().length >= 4 && frontKey !== null && selfieKey !== null;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/users/me/kyc', {
        documentType,
        documentNumber: documentNumber.trim(),
        documentFrontKey: frontKey,
        ...(backKey ? { documentBackKey: backKey } : {}),
        selfieKey,
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit your documents</CardTitle>
        <CardDescription>Accepted: Aadhaar, PAN, driving licence, voter ID, passport.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field id="documentType" label="Document type">
          <select
            id="documentType"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as typeof documentType)}
            className="min-h-[var(--tap-min,44px)] rounded-input border border-line bg-paper-0 px-3.5 text-base"
          >
            {DOCUMENT_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>

        <Field id="documentNumber" label="Document number">
          <Input value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} maxLength={40} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <DocumentUpload label="Front" kind="front" onUploaded={setFrontKey} uploaded={frontKey !== null} />
          <DocumentUpload label="Back (optional)" kind="back" onUploaded={setBackKey} uploaded={backKey !== null} />
        </div>
        <DocumentUpload label="Selfie" kind="selfie" onUploaded={setSelfieKey} uploaded={selfieKey !== null} />

        <p className="text-xs text-ink-400">
          Your document number is encrypted before storage and is never returned by any endpoint, including this one.
        </p>

        {error ? <p className="text-sm text-dispute">{error}</p> : null}

        <Button disabled={!canSubmit} loading={submitting} onClick={submit} className="w-full">
          Submit for review
        </Button>
      </CardContent>
    </Card>
  );
}

function DocumentUpload({
  label,
  kind,
  uploaded,
  onUploaded,
}: {
  label: string;
  kind: 'front' | 'back' | 'selfie';
  uploaded: boolean;
  onUploaded: (storageKey: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const presign = await api.post<{ storageKey: string; uploadUrl: string }>('/users/me/kyc/presign', {
        kind,
        contentType: file.type,
      });
      const res = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!res.ok) throw new Error('Upload failed');
      onUploaded(presign.storageKey);
    } catch {
      setError('Upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />
      <Button
        type="button"
        variant={uploaded ? 'secondary' : 'secondary'}
        loading={uploading}
        onClick={() => inputRef.current?.click()}
        className="w-full"
      >
        {uploaded ? <CheckCircle2 className="h-4 w-4 text-verified" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
        {uploaded ? `${label} added` : label}
      </Button>
      {error ? <p className="text-xs text-dispute">{error}</p> : null}
    </div>
  );
}
