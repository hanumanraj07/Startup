'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api-client';

const REASONS: { value: string; label: string }[] = [
  { value: 'WORK_NOT_DONE', label: 'The work was not actually done' },
  { value: 'EVIDENCE_INSUFFICIENT', label: 'The proof provided is not enough' },
  { value: 'INSTRUCTIONS_NOT_FOLLOWED', label: 'Instructions were not followed' },
  { value: 'EVIDENCE_FALSIFIED', label: 'The proof looks faked or misleading' },
  { value: 'UNFAIR_REJECTION', label: 'My submission was unfairly rejected' },
  { value: 'REQUESTER_UNRESPONSIVE', label: 'The requester is not responding' },
  { value: 'OTHER', label: 'Something else' },
];

/**
 * This is the only channel left for anything task-related once chat closes
 * (see chat-panel.tsx and the backend's own CHAT_WRITABLE_STATUSES comment)
 * — raising a dispute puts it in front of an admin, per
 * docs/14-dispute-resolution.md, rather than leaving it to an unmonitored
 * back-and-forth between two people who may have real money on the line.
 */
export function ReportIssueDialog({ taskId, onReported }: { taskId: string; onReported: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REASONS[0]!.value);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/tasks/${taskId}/dispute`, { reason, description: description.trim() });
      setOpen(false);
      setDescription('');
      onReported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit your report.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Flag className="h-4 w-4" aria-hidden /> Report an issue
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report an issue with this task</DialogTitle>
            <DialogDescription>
              This is reviewed by an admin, not the other party. The task is frozen while it&rsquo;s reviewed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field id="reason" label="What went wrong?">
              <select
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-[var(--tap-min,44px)] w-full rounded-input border border-line bg-paper-0 px-3 text-sm"
              >
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="description" label="Explain what happened" hint="At least 20 characters.">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={5000}
              />
            </Field>
            {error ? <p className="text-sm text-dispute">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={submitting} disabled={description.trim().length < 20}>
              Submit report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
