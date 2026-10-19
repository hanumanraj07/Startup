import { requesterTotal, rupeesToPaise } from '@onsite/money';
import { MAX_ITEM_BUDGET_PAISE, MAX_TASK_BUDGET_PAISE, MIN_TASK_BUDGET_PAISE } from '@onsite/validation';
import type { LocationMode } from '@onsite/types';
import type { CategoryView, PickedLocation, ProofRequirement, RequesterMoney } from '@/lib/api-types';

/**
 * Pure rules for the task-posting wizard, kept out of the view so they can be
 * tested. Nothing here is authoritative: the server re-validates every field
 * and computes the amounts itself when the draft is created.
 */

export const STEPS = ['Category', 'Location', 'Details', 'Proof', 'Review & pay'] as const;
export const LAST_STEP = STEPS.length - 1;

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

/**
 * What the requester will pay, shown live beside the price fields, or null
 * below the minimum task payment. Only the requester's own figures: how the
 * platform divides them is never shown (founder decision 2026-10-19). The
 * server computes the real amounts when the draft is created.
 */
export function estimateMoney(budgetPaise: number | null, itemBudgetPaise: number | null = 0): RequesterMoney | null {
  if (!budgetPaise || budgetPaise < MIN_TASK_BUDGET_PAISE) return null;
  const taskPaymentPaise = Math.min(budgetPaise, MAX_TASK_BUDGET_PAISE);
  const item = Math.min(itemBudgetPaise ?? 0, MAX_ITEM_BUDGET_PAISE);
  return {
    taskPaymentPaise,
    itemBudgetPaise: item,
    totalPaise: requesterTotal(taskPaymentPaise, item),
    itemSpentPaise: null,
    itemRefundPaise: null,
  };
}

/** The item budget that goes with the task: zero unless it is a delivery and the user chose to have something bought. */
export function effectiveItemBudget(locationMode: LocationMode, buyItem: boolean, itemBudgetPaise: number | null): number {
  return locationMode === 'PICKUP_DROPOFF' && buyItem ? (itemBudgetPaise ?? 0) : 0;
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

/**
 * The address a worker is given for a picked point: what the user typed
 * (shop name, floor, landmark) first, then the looked-up street address.
 * Either may be missing; the server requires at least 5 characters.
 */
export function composeAddress(location: PickedLocation | null): string {
  if (!location) return '';
  const details = location.details.trim();
  const suggested = location.suggestedAddress.trim();
  return [details, suggested].filter(Boolean).join(', ').slice(0, 500);
}

/** A point is usable once it is set and there is enough address text to find it. */
export function isLocationReady(location: PickedLocation | null): boolean {
  return location !== null && composeAddress(location).length >= 5;
}

export interface WizardInput {
  hasCategory: boolean;
  /** From the chosen category: one place, or a pickup and a drop-off. */
  locationMode: LocationMode;
  /** The task location; for pickup & delivery, the pickup point. */
  pickup: PickedLocation | null;
  dropoff: PickedLocation | null;
  title: string;
  description: string;
  deadlineLocal: string;
  budgetPaise: number | null;
  /** Pickup & delivery only: whether the worker should buy something, and the most they may spend. */
  buyItem: boolean;
  itemBudgetPaise: number | null;
  proofRequirements: readonly ProofRequirement[];
}

/** Whether the Continue button is enabled on `step`. The last step has no Continue; it has its own actions. */
export function canAdvance(step: number, input: WizardInput): boolean {
  switch (step) {
    case 0:
      return input.hasCategory;
    case 1:
      return isLocationReady(input.pickup) && (input.locationMode === 'SINGLE' || isLocationReady(input.dropoff));
    case 2:
      return (
        input.title.trim().length >= 8 &&
        input.description.trim().length >= 30 &&
        Boolean(input.deadlineLocal) &&
        input.budgetPaise !== null &&
        input.budgetPaise >= MIN_TASK_BUDGET_PAISE &&
        input.budgetPaise <= MAX_TASK_BUDGET_PAISE &&
        isItemBudgetReady(input)
      );
    case 3:
      return input.proofRequirements.length > 0 && input.proofRequirements.every((r) => r.label.trim().length > 0);
    default:
      return false;
  }
}

/** An item budget, when asked for, is a positive amount within the cap. */
function isItemBudgetReady(input: WizardInput): boolean {
  if (input.locationMode !== 'PICKUP_DROPOFF' || !input.buyItem) return true;
  return input.itemBudgetPaise !== null && input.itemBudgetPaise > 0 && input.itemBudgetPaise <= MAX_ITEM_BUDGET_PAISE;
}

export interface DraftPayloadInput {
  title: string;
  description: string;
  categorySlug: string;
  pickup: PickedLocation;
  /** Sent only for pickup & delivery categories. */
  dropoff: PickedLocation | null;
  budgetPaise: number;
  /** Sent only when nonzero; the server refuses it outside pickup & delivery. */
  itemBudgetPaise?: number;
  deadlineLocal: string;
  proofRequirements: readonly ProofRequirement[];
}

/** The POST /tasks body. Only what the user chose; the server decides status, fees and payout. */
export function buildDraftPayload(input: DraftPayloadInput) {
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    categorySlug: input.categorySlug,
    taskLocation: { latitude: input.pickup.latitude, longitude: input.pickup.longitude },
    taskAddress: composeAddress(input.pickup),
    ...(input.dropoff && {
      dropoffLocation: { latitude: input.dropoff.latitude, longitude: input.dropoff.longitude },
      dropoffAddress: composeAddress(input.dropoff),
    }),
    budgetPaise: input.budgetPaise,
    ...(input.itemBudgetPaise ? { itemBudgetPaise: input.itemBudgetPaise } : {}),
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
