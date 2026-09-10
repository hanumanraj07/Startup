import { Check, Circle } from 'lucide-react';
import type { ProofRequirement } from '@/lib/api-types';
import { proofTypeIcon, type ProofView } from './proof-tile';

/**
 * Required proof against what has actually been captured. This is a UI
 * convenience only — `POST /tasks/:id/submit` is the real authority on
 * whether requirements are met (docs/16-security-requirements.md), and its
 * error message is what's shown if this checklist and the server ever
 * disagree.
 */
export function ProofChecklist({ requirements, proofs }: { requirements: ProofRequirement[]; proofs: ProofView[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {requirements.map((req, i) => {
        const count = proofs.filter(
          (p) => p.type === req.type && (!req.fieldKey || p.fieldKey === req.fieldKey),
        ).length;
        const met = count >= (req.minCount ?? 1);
        const Icon = proofTypeIcon(req.type);
        return (
          <li key={i} className="flex items-center gap-2 text-sm">
            {met ? (
              <Check className="h-4 w-4 shrink-0 text-verified" aria-hidden />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-ink-300" aria-hidden />
            )}
            <Icon className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
            <span className={met ? 'text-ink-900' : 'text-ink-500'}>
              {req.label}
              {req.minCount && req.minCount > 1 ? ` (${count}/${req.minCount})` : ''}
              {!req.required ? ' — optional' : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
