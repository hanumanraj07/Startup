import { describe, expect, it } from 'vitest';
import type { CategoryView, ProofRequirement } from '@/lib/api-types';
import {
  buildDraftPayload,
  canAdvance,
  defaultProofFor,
  estimateSplit,
  FALLBACK_PROOF,
  minDeadlineLocal,
  parseBudgetPaise,
  parseCoordinate,
  type WizardInput,
} from './wizard';

const photo: ProofRequirement = { type: 'PHOTO', label: 'Photo of the item', required: true };

const valid: WizardInput = {
  hasCategory: true,
  latitude: 22.5675,
  longitude: 88.351,
  address: 'Computer market, Kolkata',
  title: 'Inspect a laptop',
  description: 'Check the laptop is in stock and photograph the sealed box. Do not buy it.',
  deadlineLocal: '2026-10-12T18:00',
  budgetPaise: 50_000,
  proofRequirements: [photo],
};

describe('parseBudgetPaise', () => {
  it('converts rupees to integer paise', () => {
    expect(parseBudgetPaise('500')).toBe(50_000);
    expect(parseBudgetPaise('499.5')).toBe(49_950);
  });

  it('is null for empty or non-numeric input', () => {
    expect(parseBudgetPaise('')).toBeNull();
    expect(parseBudgetPaise('abc')).toBeNull();
  });

  it('is null, not a crash, for input rupeesToPaise rejects', () => {
    expect(parseBudgetPaise('-5')).toBeNull();
    expect(parseBudgetPaise('1e999')).toBeNull();
  });
});

describe('estimateSplit', () => {
  it('is null with no budget or below the minimum', () => {
    expect(estimateSplit(null)).toBeNull();
    expect(estimateSplit(29_999)).toBeNull();
  });

  function splitFor(budgetPaise: number) {
    const split = estimateSplit(budgetPaise);
    if (!split) throw new Error(`expected a split for ${budgetPaise}`);
    return split;
  }

  it('splits the budget into commission and payout that add back up', () => {
    const split = splitFor(50_000);
    expect(split.budgetPaise).toBe(50_000);
    expect(split.commissionPaise + split.workerPayoutPaise).toBe(50_000);
  });

  it('caps the illustrated budget at the maximum', () => {
    expect(splitFor(99_999_999).budgetPaise).toBe(5_000_000);
  });
});

describe('defaultProofFor', () => {
  const category = (defaults: ProofRequirement[]) => ({ defaultProofRequirements: defaults }) as CategoryView;

  it('uses the category defaults, copied so edits do not leak back', () => {
    const result = defaultProofFor(category([photo]));
    expect(result).toEqual([photo]);
    expect(result[0]).not.toBe(photo);
  });

  it('falls back to a single photo requirement when the category has none', () => {
    expect(defaultProofFor(category([]))).toEqual([FALLBACK_PROOF]);
  });
});

describe('minDeadlineLocal', () => {
  it('is the local clock time plus the lead, in datetime-local format', () => {
    const now = new Date(2026, 9, 10, 14, 30); // local 14:30
    expect(minDeadlineLocal(now, 35)).toBe('2026-10-10T15:05');
  });

  it('rolls over midnight', () => {
    expect(minDeadlineLocal(new Date(2026, 9, 10, 23, 50), 35)).toBe('2026-10-11T00:25');
  });
});

describe('canAdvance', () => {
  it('requires a category on step 0', () => {
    expect(canAdvance(0, { ...valid, hasCategory: false })).toBe(false);
    expect(canAdvance(0, valid)).toBe(true);
  });

  it('requires coordinates and an address of at least 5 characters on step 1', () => {
    expect(canAdvance(1, { ...valid, latitude: null })).toBe(false);
    expect(canAdvance(1, { ...valid, longitude: null })).toBe(false);
    expect(canAdvance(1, { ...valid, address: '  abc ' })).toBe(false);
    expect(canAdvance(1, valid)).toBe(true);
  });

  it('allows latitude and longitude of exactly 0 (not treated as missing)', () => {
    expect(canAdvance(1, { ...valid, latitude: 0, longitude: 0 })).toBe(true);
  });

  it('enforces title, description, deadline and the budget range on step 2', () => {
    expect(canAdvance(2, { ...valid, title: 'short' })).toBe(false);
    expect(canAdvance(2, { ...valid, description: 'too short to explain a task' })).toBe(false);
    expect(canAdvance(2, { ...valid, deadlineLocal: '' })).toBe(false);
    expect(canAdvance(2, { ...valid, budgetPaise: null })).toBe(false);
    expect(canAdvance(2, { ...valid, budgetPaise: 29_999 })).toBe(false);
    expect(canAdvance(2, { ...valid, budgetPaise: 30_000 })).toBe(true);
    expect(canAdvance(2, { ...valid, budgetPaise: 5_000_000 })).toBe(true);
    expect(canAdvance(2, { ...valid, budgetPaise: 5_000_001 })).toBe(false);
    expect(canAdvance(2, valid)).toBe(true);
  });

  it('needs at least one proof requirement, every one labelled, on step 3', () => {
    expect(canAdvance(3, { ...valid, proofRequirements: [] })).toBe(false);
    expect(canAdvance(3, { ...valid, proofRequirements: [photo, { ...photo, label: '   ' }] })).toBe(false);
    expect(canAdvance(3, valid)).toBe(true);
  });

  it('has no Continue on the last step', () => {
    expect(canAdvance(4, valid)).toBe(false);
  });
});

describe('buildDraftPayload', () => {
  const payload = buildDraftPayload({
    title: '  Inspect a laptop ',
    description: ' Check stock. ',
    categorySlug: 'product-inspection',
    latitude: 22.5675,
    longitude: 88.351,
    address: ' Computer market ',
    budgetPaise: 50_000,
    deadlineLocal: '2026-10-12T18:00',
    proofRequirements: [
      { ...photo, label: ' Photo ' },
      { type: 'STRUCTURED_FIELD', label: 'Serial', required: true, fieldKey: 'serial_number', minCount: 2 },
    ],
  });

  it('trims user text and sends only what the user chose', () => {
    expect(payload.title).toBe('Inspect a laptop');
    expect(payload.description).toBe('Check stock.');
    expect(payload.taskAddress).toBe('Computer market');
    expect(payload.taskLocation).toEqual({ latitude: 22.5675, longitude: 88.351 });
    expect(Object.keys(payload).sort()).toEqual(
      ['budgetPaise', 'categorySlug', 'deadlineAt', 'description', 'proofRequirements', 'taskAddress', 'taskLocation', 'title'].sort(),
    );
  });

  it('sends the deadline as an ISO instant', () => {
    expect(payload.deadlineAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('keeps fieldKey and minCount only where set', () => {
    expect(payload.proofRequirements[0]).toEqual({ type: 'PHOTO', label: 'Photo', required: true });
    expect(payload.proofRequirements[1]).toEqual({
      type: 'STRUCTURED_FIELD',
      label: 'Serial',
      required: true,
      fieldKey: 'serial_number',
      minCount: 2,
    });
  });
});

describe('parseCoordinate', () => {
  it('parses plain and partial decimal text', () => {
    expect(parseCoordinate('22.5675', 90)).toBe(22.5675);
    expect(parseCoordinate('22.', 90)).toBe(22);
    expect(parseCoordinate('-88.351', 180)).toBe(-88.351);
  });

  it('keeps 0 as a real value, not as missing', () => {
    expect(parseCoordinate('0', 90)).toBe(0);
  });

  it('is null for empty, non-numeric and out-of-range text', () => {
    expect(parseCoordinate('', 90)).toBeNull();
    expect(parseCoordinate('  ', 90)).toBeNull();
    expect(parseCoordinate('abc', 90)).toBeNull();
    expect(parseCoordinate('91', 90)).toBeNull();
    expect(parseCoordinate('-181', 180)).toBeNull();
    expect(parseCoordinate('Infinity', 90)).toBeNull();
  });
});
