import { AlertTriangle, FileText, Hash, Image as ImageIcon, Video } from 'lucide-react';

export interface ProofView {
  id: string;
  type: 'PHOTO' | 'VIDEO' | 'NOTE' | 'STRUCTURED_FIELD' | 'SIGNATURE';
  url: string | null;
  fieldKey: string | null;
  fieldValue: string | null;
  noteBody: string | null;
  capturedAt: string | null;
  uploadedAt: string;
  distanceFromTaskMeters: number | null;
  verificationFlags: string[];
}

const FLAG_LABELS: Record<string, string> = {
  gps_outside_geofence: 'Captured outside the task location',
  uploaded_long_after_capture: 'Uploaded well after it was captured',
};

/**
 * One piece of evidence, shown with its verification metadata as facts, not
 * captions — including unfavourable ones. docs/19-ui-design-system.md: hiding
 * an outside-geofence flag "would destroy the only thing that makes the
 * evidence worth anything."
 */
export function ProofTile({ proof }: { proof: ProofView }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-paper-0">
      {proof.url && proof.type === 'PHOTO' ? (
        // eslint-disable-next-line @next/next/no-img-element -- presigned, short-lived, non-Next-optimizable URL
        <img src={proof.url} alt="Submitted proof" className="aspect-video w-full object-cover" />
      ) : proof.url && proof.type === 'VIDEO' ? (
        <video src={proof.url} controls className="aspect-video w-full bg-black" />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-paper-100">
          {proof.type === 'STRUCTURED_FIELD' ? (
            <Hash className="h-8 w-8 text-ink-300" aria-hidden />
          ) : (
            <FileText className="h-8 w-8 text-ink-300" aria-hidden />
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5 p-3 text-sm">
        {proof.fieldKey ? (
          <p>
            <span className="text-ink-500">{proof.fieldKey.replace(/_/g, ' ')}:</span>{' '}
            <span className="font-medium text-ink-900">{proof.fieldValue}</span>
          </p>
        ) : null}
        {proof.noteBody ? <p className="whitespace-pre-wrap text-ink-700">{proof.noteBody}</p> : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
          {proof.capturedAt ? <span>Captured {new Date(proof.capturedAt).toLocaleString('en-IN')}</span> : null}
          {proof.distanceFromTaskMeters !== null ? (
            <span className="tabular">{Math.round(proof.distanceFromTaskMeters)} m from task location</span>
          ) : null}
        </div>

        {proof.verificationFlags.map((flag) => (
          <div key={flag} className="flex items-center gap-1.5 text-xs font-medium text-progress">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {FLAG_LABELS[flag] ?? flag}
          </div>
        ))}
      </div>
    </div>
  );
}

export function proofTypeIcon(type: ProofView['type']) {
  return type === 'PHOTO' ? ImageIcon : type === 'VIDEO' ? Video : type === 'STRUCTURED_FIELD' ? Hash : FileText;
}
