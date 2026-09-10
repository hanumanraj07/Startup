import { describe, expect, it } from 'vitest';
import {
  arriveSchema,
  createPaymentOrderSchema,
  createTaskSchema,
  MAX_TASK_BUDGET_PAISE,
  MIN_TASK_BUDGET_PAISE,
  paiseSchema,
  passwordSchema,
  payoutAccountSchema,
  phoneSchema,
  registerSchema,
  resolveDisputeSchema,
  sendMessageSchema,
  updateTaskSchema,
  workerProfileSchema,
} from './index';

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

const validTask = {
  title: 'Inspect MacBook Air M4 at XYZ Computer Store',
  description:
    'Visit the store, check whether the MacBook Air M4 16/512 is in stock, ask the final price, ' +
    'photograph the sealed box and verify the serial number. Do NOT purchase it.',
  categorySlug: 'product-inspection' as const,
  taskLocation: { latitude: 22.5726, longitude: 88.3639 },
  taskAddress: 'XYZ Computer Store, Chandni Chowk, Kolkata',
  budgetPaise: 50_000,
  deadlineAt: hoursFromNow(8),
  proofRequirements: [
    { type: 'PHOTO' as const, label: 'Photo of the sealed box', required: true, minCount: 2 },
  ],
};

describe('phone', () => {
  it('accepts Indian mobile numbers in E.164', () => {
    expect(phoneSchema.safeParse('+919876543210').success).toBe(true);
  });

  it('rejects numbers without the country code', () => {
    expect(phoneSchema.safeParse('9876543210').success).toBe(false);
  });

  it('rejects invalid leading digits, since Indian mobiles start 6 to 9', () => {
    expect(phoneSchema.safeParse('+915876543210').success).toBe(false);
  });
});

describe('password', () => {
  it('requires length rather than composition', () => {
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
    expect(passwordSchema.safeParse('Sh0rt!').success).toBe(false);
  });
});

describe('paise', () => {
  it('rejects floats, because currency is never a float here', () => {
    expect(paiseSchema.safeParse(100.5).success).toBe(false);
  });

  it('rejects negatives', () => {
    expect(paiseSchema.safeParse(-1).success).toBe(false);
  });
});

describe('createTaskSchema', () => {
  it('accepts the founding example', () => {
    expect(createTaskSchema.safeParse(validTask).success).toBe(true);
  });

  it('rejects a budget below the minimum, where fixed costs consume the margin', () => {
    const result = createTaskSchema.safeParse({
      ...validTask,
      budgetPaise: MIN_TASK_BUDGET_PAISE - 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a budget above the maximum', () => {
    expect(
      createTaskSchema.safeParse({ ...validTask, budgetPaise: MAX_TASK_BUDGET_PAISE + 1 }).success,
    ).toBe(false);
  });

  it('rejects a deadline in the past', () => {
    expect(createTaskSchema.safeParse({ ...validTask, deadlineAt: hoursFromNow(-1) }).success).toBe(
      false,
    );
  });

  it('rejects a deadline too soon to be matchable', () => {
    expect(
      createTaskSchema.safeParse({ ...validTask, deadlineAt: hoursFromNow(0.1) }).success,
    ).toBe(false);
  });

  it('rejects a deadline more than 30 days out', () => {
    expect(
      createTaskSchema.safeParse({ ...validTask, deadlineAt: hoursFromNow(24 * 40) }).success,
    ).toBe(false);
  });

  it('rejects a category outside the launch six', () => {
    expect(createTaskSchema.safeParse({ ...validTask, categorySlug: 'food-delivery' }).success).toBe(
      false,
    );
  });

  it('rejects instructions too short to act on', () => {
    expect(createTaskSchema.safeParse({ ...validTask, description: 'check laptop' }).success).toBe(
      false,
    );
  });

  it('rejects out-of-range coordinates', () => {
    expect(
      createTaskSchema.safeParse({ ...validTask, taskLocation: { latitude: 91, longitude: 0 } })
        .success,
    ).toBe(false);
  });

  it('requires at least one proof requirement', () => {
    expect(createTaskSchema.safeParse({ ...validTask, proofRequirements: [] }).success).toBe(false);
  });

  it('STRIPS client-supplied commission and payout, which are server-computed', () => {
    // A client must never be able to smuggle in its own fee arithmetic.
    const parsed = createTaskSchema.parse({
      ...validTask,
      commissionPaise: 0,
      workerPayoutPaise: 50_000,
      status: 'COMPLETED',
      assignedWorkerId: 'attacker-controlled',
    } as Record<string, unknown>);

    expect(parsed).not.toHaveProperty('commissionPaise');
    expect(parsed).not.toHaveProperty('workerPayoutPaise');
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('assignedWorkerId');
  });
});

describe('updateTaskSchema', () => {
  it('allows partial updates', () => {
    expect(updateTaskSchema.safeParse({ title: 'A clearer title for the task' }).success).toBe(true);
  });

  it('accepts an empty update', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(true);
  });

  it('still validates the fields that are present', () => {
    expect(updateTaskSchema.safeParse({ budgetPaise: 10 }).success).toBe(false);
  });
});

describe('createPaymentOrderSchema', () => {
  it('carries no amount, because the server computes it from the task', () => {
    const parsed = createPaymentOrderSchema.parse({
      taskId: '0192f8c1-1c2a-7a3b-8c4d-5e6f70819293',
      amountPaise: 1,
    } as Record<string, unknown>);
    expect(parsed).not.toHaveProperty('amountPaise');
  });
});

describe('arriveSchema', () => {
  it('accepts a reported location', () => {
    expect(
      arriveSchema.safeParse({ location: { latitude: 22.5726, longitude: 88.3639 } }).success,
    ).toBe(true);
  });

  it('has no field for a client-supplied distance, which PostGIS computes', () => {
    const parsed = arriveSchema.parse({
      location: { latitude: 22.5726, longitude: 88.3639 },
      distanceFromTaskMeters: 0,
      isWithinGeofence: true,
    } as Record<string, unknown>);
    expect(parsed).not.toHaveProperty('distanceFromTaskMeters');
    expect(parsed).not.toHaveProperty('isWithinGeofence');
  });
});

describe('workerProfileSchema', () => {
  it('accepts a valid profile', () => {
    expect(
      workerProfileSchema.safeParse({
        baseLocation: { latitude: 22.5726, longitude: 88.3639 },
        baseCity: 'Kolkata',
        workingRadiusMeters: 10_000,
        categorySlugs: ['product-inspection'],
      }).success,
    ).toBe(true);
  });

  it('requires at least one category', () => {
    expect(
      workerProfileSchema.safeParse({
        baseLocation: { latitude: 22.5726, longitude: 88.3639 },
        baseCity: 'Kolkata',
        workingRadiusMeters: 10_000,
        categorySlugs: [],
      }).success,
    ).toBe(false);
  });

  it('caps the working radius', () => {
    expect(
      workerProfileSchema.safeParse({
        baseLocation: { latitude: 22.5726, longitude: 88.3639 },
        baseCity: 'Kolkata',
        workingRadiusMeters: 500_000,
        categorySlugs: ['product-inspection'],
      }).success,
    ).toBe(false);
  });
});

describe('payoutAccountSchema', () => {
  it('accepts a bank account with IFSC and PAN', () => {
    expect(
      payoutAccountSchema.safeParse({
        type: 'BANK',
        accountNumber: '123456789012',
        ifsc: 'HDFC0001234',
        panNumber: 'ABCDE1234F',
      }).success,
    ).toBe(true);
  });

  it('accepts a UPI account', () => {
    expect(
      payoutAccountSchema.safeParse({ type: 'UPI', upiVpa: 'rahul@ybl', panNumber: 'ABCDE1234F' })
        .success,
    ).toBe(true);
  });

  it('rejects a bank account missing its IFSC', () => {
    expect(
      payoutAccountSchema.safeParse({
        type: 'BANK',
        accountNumber: '123456789012',
        panNumber: 'ABCDE1234F',
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed PAN', () => {
    expect(
      payoutAccountSchema.safeParse({ type: 'UPI', upiVpa: 'rahul@ybl', panNumber: 'BAD' }).success,
    ).toBe(false);
  });
});

describe('sendMessageSchema', () => {
  it('requires a body or an attachment', () => {
    expect(sendMessageSchema.safeParse({}).success).toBe(false);
    expect(sendMessageSchema.safeParse({ body: 'On my way' }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ attachmentKey: 'proofs/abc.jpg' }).success).toBe(true);
  });
});

describe('resolveDisputeSchema', () => {
  it('requires a share percentage for a split', () => {
    expect(
      resolveDisputeSchema.safeParse({
        resolution: 'SPLIT',
        notes: 'Partially completed, evidence covers two of four requirements.',
      }).success,
    ).toBe(false);
  });

  it('accepts a split with a percentage', () => {
    expect(
      resolveDisputeSchema.safeParse({
        resolution: 'SPLIT',
        workerSharePercent: 50,
        notes: 'Partially completed, evidence covers two of four requirements.',
      }).success,
    ).toBe(true);
  });

  it('requires recorded reasoning on every decision', () => {
    expect(resolveDisputeSchema.safeParse({ resolution: 'RELEASE_TO_WORKER', notes: 'ok' }).success).toBe(
      false,
    );
  });
});

describe('registerSchema', () => {
  it('normalises email to lowercase', () => {
    const parsed = registerSchema.parse({
      email: '  Rahul@Example.COM ',
      password: 'a-long-enough-password',
      displayName: 'Rahul Sharma',
    });
    expect(parsed.email).toBe('rahul@example.com');
  });
});
