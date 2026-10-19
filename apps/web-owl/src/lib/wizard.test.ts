import { describe, expect, it } from 'vitest';
import type { CategoryView, PickedLocation, ProofRequirement } from '@/lib/api-types';
import {
  buildDraftPayload,
  canAdvance,
  composeAddress,
  defaultProofFor,
  effectiveItemBudget,
  estimateMoney,
  FALLBACK_PROOF,
  minDeadlineLocal,
  parseBudgetPaise,
  type WizardInput,
} from './wizard';

const photo: ProofRequirement = { type: 'PHOTO', label: 'Photo of the item', required: true };

const shop: PickedLocation = {
  latitude: 22.5675,
  longitude: 88.351,
  suggestedAddress: 'Bentinck Street, Kolkata, West Bengal',
  details: 'XYZ Computer Store, 2nd floor',
};
const home: PickedLocation = { latitude: 22.5526, longitude: 88.3527, suggestedAddress: 'Park Street, Kolkata', details: '' };

const valid: WizardInput = {
  hasCategory: true,
  isOtherCategory: false,
  customCategoryLabel: '',
  locationMode: 'SINGLE',
  pickup: shop,
  dropoff: null,
  title: 'Inspect a laptop',
  description: 'Check the laptop is in stock and photograph the sealed box. Do not buy it.',
  deadlineLocal: '2026-10-12T18:00',
  budgetPaise: 50_000,
  buyItem: false,
  itemBudgetPaise: null,
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

describe('estimateMoney', () => {
  it('is null with no task payment or below the minimum', () => {
    expect(estimateMoney(null)).toBeNull();
    expect(estimateMoney(9_999)).toBeNull();
  });

  it("shows the requester's total — task payment plus item budget — and never a commission", () => {
    const money = estimateMoney(20_000, 100_000);
    expect(money).toEqual({
      taskPaymentPaise: 20_000,
      itemBudgetPaise: 100_000,
      itemTopUpPaise: 0,
      totalPaise: 120_000,
      itemSpentPaise: null,
      itemRefundPaise: null,
    });
    expect(JSON.stringify(money)).not.toMatch(/commission|payout/i);
  });

  it('caps the illustrated amounts at the maximums', () => {
    expect(estimateMoney(99_999_999)?.taskPaymentPaise).toBe(5_000_000);
    expect(estimateMoney(20_000, 99_999_999)?.itemBudgetPaise).toBe(1_000_000);
  });
});

describe('effectiveItemBudget', () => {
  it('is only ever nonzero on a delivery where the user asked for something to be bought', () => {
    expect(effectiveItemBudget('PICKUP_DROPOFF', true, 100_000)).toBe(100_000);
    expect(effectiveItemBudget('PICKUP_DROPOFF', false, 100_000)).toBe(0);
    expect(effectiveItemBudget('SINGLE', true, 100_000)).toBe(0);
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
    // "Other" needs a few words saying what kind of task it is.
    expect(canAdvance(0, { ...valid, isOtherCategory: true, customCategoryLabel: '  ' })).toBe(false);
    expect(canAdvance(0, { ...valid, isOtherCategory: true, customCategoryLabel: 'Stand in a queue' })).toBe(true);
    expect(canAdvance(0, valid)).toBe(true);
  });

  it('requires a picked point with enough address text on step 1', () => {
    expect(canAdvance(1, { ...valid, pickup: null })).toBe(false);
    expect(canAdvance(1, { ...valid, pickup: { ...shop, suggestedAddress: '', details: ' abc ' } })).toBe(false);
    // Typed details alone are enough when the address lookup found nothing.
    expect(canAdvance(1, { ...valid, pickup: { ...shop, suggestedAddress: '' } })).toBe(true);
    expect(canAdvance(1, valid)).toBe(true);
  });

  it('asks for a drop-off only for pickup & delivery categories', () => {
    expect(canAdvance(1, { ...valid, locationMode: 'PICKUP_DROPOFF' })).toBe(false);
    expect(canAdvance(1, { ...valid, locationMode: 'PICKUP_DROPOFF', dropoff: home })).toBe(true);
    expect(canAdvance(1, { ...valid, locationMode: 'SINGLE', dropoff: null })).toBe(true);
  });

  it('enforces title, description, deadline and the budget range on step 2', () => {
    expect(canAdvance(2, { ...valid, title: 'short' })).toBe(false);
    expect(canAdvance(2, { ...valid, description: 'too short to explain a task' })).toBe(false);
    expect(canAdvance(2, { ...valid, deadlineLocal: '' })).toBe(false);
    expect(canAdvance(2, { ...valid, budgetPaise: null })).toBe(false);
    expect(canAdvance(2, { ...valid, budgetPaise: 9_999 })).toBe(false);
    expect(canAdvance(2, { ...valid, budgetPaise: 10_000 })).toBe(true);
    // The founder's example: ₹200 for the task.
    expect(canAdvance(2, { ...valid, budgetPaise: 20_000 })).toBe(true);
    expect(canAdvance(2, { ...valid, budgetPaise: 5_000_000 })).toBe(true);
    expect(canAdvance(2, { ...valid, budgetPaise: 5_000_001 })).toBe(false);
    expect(canAdvance(2, valid)).toBe(true);
  });

  it('needs a positive item budget within the cap when a delivery should buy something', () => {
    const delivery = { ...valid, locationMode: 'PICKUP_DROPOFF' as const, dropoff: home, buyItem: true };
    expect(canAdvance(2, { ...delivery, itemBudgetPaise: null })).toBe(false);
    expect(canAdvance(2, { ...delivery, itemBudgetPaise: 0 })).toBe(false);
    expect(canAdvance(2, { ...delivery, itemBudgetPaise: 1_000_001 })).toBe(false);
    expect(canAdvance(2, { ...delivery, itemBudgetPaise: 100_000 })).toBe(true);
    // Not asked for, or not a delivery: the field does not matter.
    expect(canAdvance(2, { ...delivery, buyItem: false, itemBudgetPaise: null })).toBe(true);
    expect(canAdvance(2, { ...valid, buyItem: true, itemBudgetPaise: null })).toBe(true);
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
    pickup: { ...shop, details: ' XYZ Computer Store ' },
    dropoff: null,
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
    expect(payload.taskAddress).toBe('XYZ Computer Store, Bentinck Street, Kolkata, West Bengal');
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

describe('pickup & delivery payload', () => {
  it('sends the drop-off with its own composed address', () => {
    const payload = buildDraftPayload({
      title: 'Deliver a parcel',
      description: 'Collect the parcel and hand it over.',
      categorySlug: 'pickup-delivery',
      pickup: shop,
      dropoff: { ...home, details: 'Flat 4B' },
      budgetPaise: 50_000,
      deadlineLocal: '2026-10-12T18:00',
      proofRequirements: [photo],
    });
    expect(payload.dropoffLocation).toEqual({ latitude: 22.5526, longitude: 88.3527 });
    expect(payload.dropoffAddress).toBe('Flat 4B, Park Street, Kolkata');
    expect(payload).not.toHaveProperty('itemBudgetPaise');
  });

  it('sends an item budget only when there is one', () => {
    const payload = buildDraftPayload({
      title: 'Buy and deliver a charger',
      description: 'Buy a 65W charger and deliver it.',
      categorySlug: 'pickup-delivery',
      pickup: shop,
      dropoff: home,
      budgetPaise: 20_000,
      itemBudgetPaise: 100_000,
      deadlineLocal: '2026-10-12T18:00',
      proofRequirements: [photo],
    });
    expect(payload.itemBudgetPaise).toBe(100_000);
    expect(payload.budgetPaise).toBe(20_000);
  });
});

describe('composeAddress', () => {
  it('puts what the user typed before the looked-up address, skipping whichever is empty', () => {
    expect(composeAddress(shop)).toBe('XYZ Computer Store, 2nd floor, Bentinck Street, Kolkata, West Bengal');
    expect(composeAddress({ ...shop, details: '  ' })).toBe('Bentinck Street, Kolkata, West Bengal');
    expect(composeAddress(null)).toBe('');
  });
});

describe('"Other" category payload', () => {
  const base = {
    title: 'Stand in the queue',
    description: 'Hold my place in the queue until I arrive.',
    pickup: shop,
    dropoff: null,
    budgetPaise: 20_000,
    deadlineLocal: '2026-10-12T18:00',
    proofRequirements: [photo],
  };

  it('sends the trimmed label for "Other" only', () => {
    expect(buildDraftPayload({ ...base, categorySlug: 'other', customCategoryLabel: '  Queue  ' }).customCategoryLabel).toBe('Queue');
    expect(buildDraftPayload({ ...base, categorySlug: 'local-research', customCategoryLabel: 'Queue' })).not.toHaveProperty(
      'customCategoryLabel',
    );
  });
});
