import { describe, expect, it } from 'vitest';
import {
  applyBps,
  assertPaise,
  calculateCancellationCompensation,
  calculateDisputeSplit,
  calculateSplit,
  formatPaise,
  MoneyError,
  paiseToRupees,
  rupeesToPaise,
  splitBalances,
  ZERO_DEDUCTIONS,
} from './index';

describe('paise validation', () => {
  it('rejects non-integers, because floating point currency loses money', () => {
    expect(() => assertPaise(100.5)).toThrow(MoneyError);
  });

  it('rejects negatives', () => {
    expect(() => assertPaise(-1)).toThrow(MoneyError);
  });

  it('rejects values beyond the safe integer range', () => {
    expect(() => assertPaise(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });

  it('accepts zero', () => {
    expect(() => assertPaise(0)).not.toThrow();
  });
});

describe('conversion', () => {
  it('converts rupees to paise', () => {
    expect(rupeesToPaise(500)).toBe(50_000);
    expect(rupeesToPaise(1)).toBe(100);
    expect(rupeesToPaise(0.5)).toBe(50);
  });

  it('round-trips', () => {
    expect(paiseToRupees(rupeesToPaise(1234.56))).toBeCloseTo(1234.56, 2);
  });

  it('does not accumulate float error on the classic case', () => {
    // 0.1 + 0.2 !== 0.3 in floats. In paise it is exact.
    expect(rupeesToPaise(0.1) + rupeesToPaise(0.2)).toBe(rupeesToPaise(0.3));
  });
});

describe('formatting', () => {
  it('uses Indian digit grouping, not thousands grouping', () => {
    // ₹1,00,000 — not ₹100,000. Getting this wrong looks foreign to the user.
    expect(formatPaise(10_000_000)).toContain('1,00,000');
  });

  it('omits decimals for whole rupee amounts', () => {
    expect(formatPaise(50_000)).toBe('₹500');
  });

  it('shows decimals when there are paise', () => {
    expect(formatPaise(50_050)).toBe('₹500.50');
  });

  it('forces decimals on request', () => {
    expect(formatPaise(50_000, { forceDecimals: true })).toBe('₹500.00');
  });
});

describe('applyBps', () => {
  it('applies a 15% rate', () => {
    expect(applyBps(100_000, 1500)).toBe(15_000);
  });

  it('handles zero rate', () => {
    expect(applyBps(100_000, 0)).toBe(0);
  });

  it('rejects a rate above 100%', () => {
    expect(() => applyBps(100_000, 10_001)).toThrow(MoneyError);
  });

  it('returns an integer for rates that do not divide evenly', () => {
    const result = applyBps(33_333, 1500);
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe('calculateSplit — the founding example', () => {
  it('splits a ₹500 task at 15% into ₹75 commission and ₹425 payout', () => {
    const split = calculateSplit(50_000, 1500);
    expect(split.commissionPaise).toBe(7_500);
    expect(split.workerPayoutPaise).toBe(42_500);
    expect(formatPaise(split.commissionPaise)).toBe('₹75');
    expect(formatPaise(split.workerPayoutPaise)).toBe('₹425');
  });

  it('splits a ₹1,000 task into ₹150 and ₹850, matching the business model doc', () => {
    const split = calculateSplit(100_000, 1500);
    expect(split.commissionPaise).toBe(15_000);
    expect(split.workerPayoutPaise).toBe(85_000);
  });
});

describe('calculateSplit — the balancing invariant', () => {
  it('balances exactly for the founding example', () => {
    expect(splitBalances(calculateSplit(50_000, 1500))).toBe(true);
  });

  it('balances for every budget in a wide sweep, including awkward remainders', () => {
    for (let budget = 30_000; budget <= 500_000; budget += 331) {
      const split = calculateSplit(budget, 1500);
      expect(splitBalances(split)).toBe(true);
      expect(split.commissionPaise + split.workerPayoutPaise).toBe(budget);
    }
  });

  it('balances across many commission rates', () => {
    for (let bps = 0; bps <= 3000; bps += 37) {
      const split = calculateSplit(123_457, bps);
      expect(splitBalances(split)).toBe(true);
    }
  });

  it('balances with statutory deductions enabled', () => {
    const split = calculateSplit(100_000, 1500, {
      gstOnCommissionBps: 1800,
      tcsBps: 50,
      tds194OBps: 100,
    });
    expect(splitBalances(split)).toBe(true);
    expect(
      split.commissionPaise +
        split.gstPaise +
        split.tcsPaise +
        split.tdsPaise +
        split.workerPayoutPaise,
    ).toBe(100_000);
  });

  it('computes GST on the commission, not on the whole budget', () => {
    const split = calculateSplit(100_000, 1500, { ...ZERO_DEDUCTIONS, gstOnCommissionBps: 1800 });
    // 18% of the ₹150 commission is ₹27, not 18% of ₹1,000.
    expect(split.gstPaise).toBe(2_700);
  });

  it('takes nothing when the commission rate is zero', () => {
    const split = calculateSplit(50_000, 0);
    expect(split.commissionPaise).toBe(0);
    expect(split.workerPayoutPaise).toBe(50_000);
  });

  it('refuses to build a split where deductions exceed the budget', () => {
    expect(() =>
      calculateSplit(1_000, 9_000, { gstOnCommissionBps: 10_000, tcsBps: 5_000, tds194OBps: 5_000 }),
    ).toThrow(MoneyError);
  });
});

describe('calculateDisputeSplit', () => {
  it('splits evenly without losing a paisa', () => {
    const split = calculateDisputeSplit(50_000, 50);
    expect(split.workerPaise).toBe(25_000);
    expect(split.refundPaise).toBe(25_000);
    expect(split.workerPaise + split.refundPaise).toBe(50_000);
  });

  it('reconstructs the held amount at any odd percentage', () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      const split = calculateDisputeSplit(33_333, percent);
      expect(split.workerPaise + split.refundPaise).toBe(33_333);
    }
  });

  it('awards everything at 100 and nothing at 0', () => {
    expect(calculateDisputeSplit(50_000, 100).refundPaise).toBe(0);
    expect(calculateDisputeSplit(50_000, 0).workerPaise).toBe(0);
  });

  it('rejects a percentage outside 0 to 100', () => {
    expect(() => calculateDisputeSplit(50_000, 101)).toThrow(MoneyError);
    expect(() => calculateDisputeSplit(50_000, -1)).toThrow(MoneyError);
  });
});

describe('calculateCancellationCompensation', () => {
  it('pays 10% up to a ₹50 cap', () => {
    expect(calculateCancellationCompensation(30_000)).toBe(3_000); // ₹300 → ₹30
    expect(calculateCancellationCompensation(100_000)).toBe(5_000); // ₹1000 → capped at ₹50
  });

  it('never exceeds the budget itself', () => {
    expect(calculateCancellationCompensation(1_000)).toBe(100);
  });

  it('honours overridden rates', () => {
    expect(calculateCancellationCompensation(100_000, { percentBps: 2000, capPaise: 100_000 })).toBe(
      20_000,
    );
  });
});
