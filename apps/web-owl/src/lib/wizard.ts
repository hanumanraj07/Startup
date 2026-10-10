import { calculateSplit, rupeesToPaise, ZERO_DEDUCTIONS, type TaskSplit } from '@onsite/money';
import { MAX_TASK_BUDGET_PAISE, MIN_TASK_BUDGET_PAISE } from '@onsite/validation';
import type { CategoryView, ProofRequirement } from '@/lib/api-types';

/**
 * Pure rules for the task-posting wizard, kept out of the view so they can be
 * tested. Nothing here is authoritative: the server re-validates every field
 * and computes the real commission and payout when the draft is created.
 */

export const STEPS = ['Category', 'Location', 'Details', 'Proof', 'Review & pay'] as const;
export const LAST_STEP = STEPS.length - 1;

/**
 * A rough, client-side illustration only. The server computes and returns the
 * authoritative split the moment the draft is created (docs/16-security-
 * requirements.md: commission and payout are never taken from the client).
 * 15% mirrors docs/02-business-model.md's headline rate; the real value can
 * differ if the deployment's env overrides it.
 */
export const ILLUSTRATIVE_COMMISSION_BPS = 1500;

export const FALLBACK_PROOF: ProofRequirement = { type: 'PHOTO', label: 'Photo evidence', required: true };

/** The budget field's text as integer paise, or null when it is empty or not a usable amount. */
export function parseBudgetPaise(rupees: string): number | null {
  const value = Number(rupees);
  if (!rupees || Number.isNaN(value)) return null;
  try {
    return rupeesToPaise(value);
  } catch {
    // Negative, infinite or absurdly large input: not a budget, and not a reason to crash the screen.
    return null;
  }
}

/** The pre-payment estimate shown beside the budget field, or null below the minimum budget. */
export function estimateSplit(budgetPaise: number | null): TaskSplit | null {
  if (!budgetPaise || budgetPaise < MIN_TASK_BUDGET_PAISE) return null;
  return calculateSplit(Math.min(budgetPaise, MAX_TASK_BUDGET_PAISE), ILLUSTRATIVE_COMMISSION_BPS, ZERO_DEDUCTIONS);
}

/** A category's suggested proof, or a single photo requirement when it has none. */
export function defaultProofFor(category: CategoryView): ProofRequirement[] {
  const defaults = category.defaultProofRequirements;
  return Array.isArray(defaults) && defaults.length > 0 ? defaults.map((r) => ({ ...r })) : [{ ...FALLBACK_PROOF }];
}

/**
 * The earliest deadline the picker offers, as the local "YYYY-MM-DDTHH:mm"
 * string a datetime-local input expects. It is built from local clock fields:
 * the old `toISOString().slice(0, 16)` is a UTC string, which in India made the
 * minimum 5.5 hours too early.
 */
export function minDeadlineLocal(now: Date = new Date(), leadMinutes = 35): string {
  const d = new Date(now.getTime() + leadMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface WizardInput {
  hasCategory: boolean;
  latitude: number | null;
  longitude: number | null;
  address: string;
  title: string;
  description: string;
  deadlineLocal: string;
  budgetPaise: number | null;
  proofRequirements: readonly ProofRequirement[];
}

/** Whether the Continue button is enabled on `step`. The last step has no Continue; it has its own actions. */
export function canAdvance(step: number, input: WizardInput): boolean {
  switch (step) {
    case 0:
      return input.hasCategory;
    case 1:
      return input.latitude !== null && input.longitude !== null && input.address.trim().length >= 5;
    case 2:
      return (
        input.title.trim().length >= 8 &&
        input.description.trim().length >= 30 &&
        Boolean(input.deadlineLocal) &&
        input.budgetPaise !== null &&
        input.budgetPaise >= MIN_TASK_BUDGET_PAISE &&
        input.budgetPaise <= MAX_TASK_BUDGET_PAISE
      );
    case 3:
      return input.proofRequirements.length > 0 && input.proofRequirements.every((r) => r.label.trim().length > 0);
    default:
      return false;
  }
}

export interface DraftPayloadInput {
  title: string;
  description: string;
  categorySlug: string;
  latitude: number;
  longitude: number;
  address: string;
  budgetPaise: number;
  deadlineLocal: string;
  proofRequirements: readonly ProofRequirement[];
}

/** The POST /tasks body. Only what the user chose; the server decides status, fees and payout. */
export function buildDraftPayload(input: DraftPayloadInput) {
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    categorySlug: input.categorySlug,
    taskLocation: { latitude: input.latitude, longitude: input.longitude },
    taskAddress: input.address.trim(),
    budgetPaise: input.budgetPaise,
    deadlineAt: new Date(input.deadlineLocal).toISOString(),
    proofRequirements: input.proofRequirements.map((r) => ({
      type: r.type,
      label: r.label.trim(),
      required: r.required,
      ...(r.fieldKey ? { fieldKey: r.fieldKey } : {}),
      ...(r.minCount ? { minCount: r.minCount } : {}),
    })),
  };
}

/**
 * A latitude or longitude typed into a text box, as a number, or null when it is
 * empty, not a number, or outside `[-limit, limit]`. The wizard keeps these as
 * text while editing so a partial entry like "22." is not rewritten under the
 * cursor.
 */
export function parseCoordinate(text: string, limit: number): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}
