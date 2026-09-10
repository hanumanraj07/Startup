/**
 * All money in OnSite is integer paise. Never floats, never rupees in storage.
 *
 * This package is the ONLY place fee and split arithmetic lives. Both the API
 * and the web app import it, so the fee a requester is quoted is arithmetically
 * identical to the fee they are charged.
 *
 * See docs/02-business-model.md and docs/11-payment-flow.md.
 */

/** An integer number of paise. ₹500 is 50000. */
export type Paise = number;

/** Basis points. 1500 = 15.00%. */
export type Bps = number;

export const PAISE_PER_RUPEE = 100;
export const BPS_DIVISOR = 10_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Throws unless the value is a safe, non-negative integer. */
export function assertPaise(value: number, label = 'amount'): asserts value is Paise {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of paise, received ${value}`);
  }
  if (value < 0) {
    throw new MoneyError(`${label} must not be negative, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} exceeds the safe integer range`);
  }
}

export function assertBps(value: number, label = 'rate'): asserts value is Bps {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer in basis points, received ${value}`);
  }
  if (value < 0 || value > BPS_DIVISOR) {
    throw new MoneyError(`${label} must be between 0 and ${BPS_DIVISOR} bps, received ${value}`);
  }
}

export function rupeesToPaise(rupees: number): Paise {
  const paise = Math.round(rupees * PAISE_PER_RUPEE);
  assertPaise(paise, 'rupeesToPaise result');
  return paise;
}

export function paiseToRupees(paise: Paise): number {
  assertPaise(paise);
  return paise / PAISE_PER_RUPEE;
}

/**
 * Formats paise for display using Indian digit grouping, so ₹1,00,000 rather
 * than ₹100,000. Whole rupee amounts omit the decimal part, because most task
 * budgets are round numbers and trailing ".00" is noise.
 */
export function formatPaise(paise: Paise, options: { forceDecimals?: boolean } = {}): string {
  assertPaise(paise);
  const isWhole = paise % PAISE_PER_RUPEE === 0;
  const fractionDigits = !options.forceDecimals && isWhole ? 0 : 2;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(paiseToRupees(paise));
}

/**
 * Applies a basis-point rate, rounding half away from zero.
 *
 * JavaScript's Math.round rounds half toward positive infinity, which is
 * asymmetric. Amounts here are non-negative so the two agree, but the
 * behaviour is stated explicitly rather than inherited by accident.
 */
export function applyBps(amountPaise: Paise, rateBps: Bps): Paise {
  assertPaise(amountPaise);
  assertBps(rateBps);
  return Math.round((amountPaise * rateBps) / BPS_DIVISOR);
}

/**
 * Statutory deduction rates, all in basis points.
 *
 * These default to zero and MUST be confirmed by a chartered accountant
 * before being enabled. They exist from day one so that turning them on is
 * configuration rather than a schema migration under a tax deadline.
 * See docs/02-business-model.md.
 */
export interface DeductionRates {
  /** GST charged on the platform's commission. */
  gstOnCommissionBps: Bps;
  /** Tax collected at source under GST. */
  tcsBps: Bps;
  /** Tax deducted at source under section 194-O. */
  tds194OBps: Bps;
}

export const ZERO_DEDUCTIONS: DeductionRates = {
  gstOnCommissionBps: 0,
  tcsBps: 0,
  tds194OBps: 0,
};

export interface TaskSplit {
  /** What the requester pays. */
  budgetPaise: Paise;
  /** The commission rate applied, stored on the task so history survives rate changes. */
  commissionRateBps: Bps;
  /** The platform's commission. */
  commissionPaise: Paise;
  /** GST on that commission. */
  gstPaise: Paise;
  /** Tax collected at source. */
  tcsPaise: Paise;
  /** Tax deducted at source. */
  tdsPaise: Paise;
  /** What actually reaches the worker. */
  workerPayoutPaise: Paise;
}

/**
 * Splits a task budget into commission, statutory deductions and worker payout.
 *
 * The invariant that matters, and that the ledger depends on:
 *
 *   commission + gst + tcs + tds + workerPayout === budget
 *
 * exactly, with no rounding drift. This is guaranteed by deriving the worker's
 * payout as the remainder rather than computing it independently.
 */
export function calculateSplit(
  budgetPaise: Paise,
  commissionRateBps: Bps,
  deductions: DeductionRates = ZERO_DEDUCTIONS,
): TaskSplit {
  assertPaise(budgetPaise, 'budgetPaise');
  assertBps(commissionRateBps, 'commissionRateBps');
  assertBps(deductions.gstOnCommissionBps, 'gstOnCommissionBps');
  assertBps(deductions.tcsBps, 'tcsBps');
  assertBps(deductions.tds194OBps, 'tds194OBps');

  const commissionPaise = applyBps(budgetPaise, commissionRateBps);
  const gstPaise = applyBps(commissionPaise, deductions.gstOnCommissionBps);
  const tcsPaise = applyBps(budgetPaise, deductions.tcsBps);
  const tdsPaise = applyBps(budgetPaise, deductions.tds194OBps);

  const deducted = commissionPaise + gstPaise + tcsPaise + tdsPaise;

  if (deducted > budgetPaise) {
    throw new MoneyError(
      `Deductions (${deducted} paise) exceed the budget (${budgetPaise} paise). ` +
        'Check the commission and statutory rates.',
    );
  }

  // Derived as the remainder, never computed independently, so the parts
  // always sum back to the budget exactly.
  const workerPayoutPaise = budgetPaise - deducted;

  return {
    budgetPaise,
    commissionRateBps,
    commissionPaise,
    gstPaise,
    tcsPaise,
    tdsPaise,
    workerPayoutPaise,
  };
}

/** True when a split reconciles exactly. Asserted in tests and by reconciliation. */
export function splitBalances(split: TaskSplit): boolean {
  return (
    split.commissionPaise +
      split.gstPaise +
      split.tcsPaise +
      split.tdsPaise +
      split.workerPayoutPaise ===
    split.budgetPaise
  );
}

/**
 * Splits a held amount between worker and refund for a partial dispute
 * resolution, expressed as the percentage awarded to the worker.
 *
 * The platform waives its commission on a split: a partial failure is partly a
 * matching failure, and charging for it is indefensible.
 * See docs/14-dispute-resolution.md.
 */
export interface DisputeSplit {
  heldPaise: Paise;
  workerSharePercent: number;
  workerPaise: Paise;
  refundPaise: Paise;
}

export function calculateDisputeSplit(heldPaise: Paise, workerSharePercent: number): DisputeSplit {
  assertPaise(heldPaise, 'heldPaise');
  if (!Number.isFinite(workerSharePercent) || workerSharePercent < 0 || workerSharePercent > 100) {
    throw new MoneyError(`workerSharePercent must be between 0 and 100, received ${workerSharePercent}`);
  }

  const workerPaise = Math.round((heldPaise * workerSharePercent) / 100);
  // Remainder again, so the two parts always reconstruct the held amount.
  const refundPaise = heldPaise - workerPaise;

  return { heldPaise, workerSharePercent, workerPaise, refundPaise };
}

/**
 * Worker compensation when a requester cancels after a worker has been
 * assigned and may already have travelled.
 *
 * The rate is a business decision, not an engineering one. See the open
 * questions in ai/memory.md.
 */
export function calculateCancellationCompensation(
  budgetPaise: Paise,
  options: { percentBps?: Bps; capPaise?: Paise } = {},
): Paise {
  assertPaise(budgetPaise, 'budgetPaise');
  const percentBps = options.percentBps ?? 1000; // 10%
  const capPaise = options.capPaise ?? 5000; // ₹50
  assertBps(percentBps, 'percentBps');
  assertPaise(capPaise, 'capPaise');

  return Math.min(applyBps(budgetPaise, percentBps), capPaise, budgetPaise);
}
