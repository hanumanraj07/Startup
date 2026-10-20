import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TasksService } from './tasks.service';
import { RiskService } from './risk.service';
import { BusinessRuleError } from '../../common/errors';
import { resetEnvCache } from '../../config/env';

/**
 * Pickup & delivery: whether a task has a drop-off is decided by its
 * category, never by the client, and the drop-off must be a real, reachable
 * second point. Distances come from PostGIS (stubbed here).
 */

const BASE_ENV = {
  DATABASE_URL: 'postgresql://onsite:onsite@localhost:5432/onsite_app',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_BUCKET: 'onsite-media',
  STORAGE_ACCESS_KEY: 'x',
  STORAGE_SECRET_KEY: 'y',
  MAX_DELIVERY_DISTANCE_M: '50000',
};

beforeEach(() => {
  resetEnvCache();
  process.env = { ...process.env, ...BASE_ENV };
});

const pickup = { latitude: 23.0276, longitude: 72.5603 };
const dropoffLocation = { latitude: 23.0225, longitude: 72.5878 };

function build(locationMode: 'SINGLE' | 'PICKUP_DROPOFF', distanceMeters = 2_900, slug = 'pickup-delivery') {
  const taskCreate = vi.fn().mockResolvedValue({ id: 't1' });
  const prisma = {
    category: { findFirst: vi.fn().mockResolvedValue({ id: 'cat-1', locationMode, slug }) },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ homeLat: null, homeLng: null }) },
    task: { create: taskCreate },
    taskStatusHistory: { create: vi.fn().mockResolvedValue({}) },
  };
  const geo = {
    findNearestCity: vi.fn().mockResolvedValue({ id: 'city-1' }),
    distanceBetween: vi.fn().mockResolvedValue(distanceMeters),
  };
  const moderation = { screenTask: vi.fn().mockResolvedValue(undefined) };
  const service = new TasksService(
    prisma as never,
    geo as never,
    new RiskService(),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    moderation as never,
    {} as never,
    {} as never,
    {} as never,
  );
  vi.spyOn(service, 'getById').mockResolvedValue({} as never);
  return { service, taskCreate, geo };
}

const input = {
  title: 'Collect a parcel and deliver it',
  description: 'Pick up the sealed parcel from the counter and hand it to the person named in chat.',
  categorySlug: 'pickup-delivery' as const,
  taskLocation: pickup,
  taskAddress: 'Iscon Mall, CG Road, Ahmedabad',
  budgetPaise: 50_000,
  deadlineAt: new Date(Date.now() + 3_600_000),
  proofRequirements: [{ type: 'PHOTO' as const, label: 'Handover photo', required: true }],
};

describe('TasksService.create — drop-off rules', () => {
  it('stores the drop-off for a pickup & delivery category', async () => {
    const { service, taskCreate } = build('PICKUP_DROPOFF');
    await service.create('req-1', { ...input, dropoffLocation, dropoffAddress: 'Manek Chowk, Old City, Ahmedabad' });
    expect(taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskLat: pickup.latitude,
        dropoffLat: dropoffLocation.latitude,
        dropoffLng: dropoffLocation.longitude,
        dropoffAddress: 'Manek Chowk, Old City, Ahmedabad',
      }),
    });
  });

  it('requires a drop-off for a pickup & delivery category', async () => {
    const { service, taskCreate } = build('PICKUP_DROPOFF');
    await expect(service.create('req-1', input)).rejects.toThrow(/Add where the item should be delivered/);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('refuses a drop-off on a one-location category, and stores none otherwise', async () => {
    const refused = build('SINGLE');
    await expect(
      refused.service.create('req-1', { ...input, categorySlug: 'product-inspection', dropoffLocation, dropoffAddress: 'Somewhere else' }),
    ).rejects.toThrow(BusinessRuleError);

    const plain = build('SINGLE');
    await plain.service.create('req-1', { ...input, categorySlug: 'product-inspection' });
    expect(plain.taskCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ dropoffLat: null, dropoffAddress: null }) });
    expect(plain.geo.distanceBetween).not.toHaveBeenCalled();
  });

  it('refuses a drop-off on top of the pickup, or beyond the delivery limit', async () => {
    const same = build('PICKUP_DROPOFF', 12);
    await expect(
      same.service.create('req-1', { ...input, dropoffLocation, dropoffAddress: 'Same shop, CG Road' }),
    ).rejects.toThrow(/same place as the pickup/);

    const far = build('PICKUP_DROPOFF', 120_000);
    await expect(
      far.service.create('req-1', { ...input, dropoffLocation, dropoffAddress: 'Vadodara railway station' }),
    ).rejects.toThrow(/up to 50 km .* 120\.0 km away/);
  });

  it('refuses a drop-off outside India', async () => {
    const { service } = build('PICKUP_DROPOFF');
    await expect(
      service.create('req-1', { ...input, dropoffLocation: { latitude: 51.5, longitude: -0.12 }, dropoffAddress: 'London' }),
    ).rejects.toThrow(/within India/);
  });
});

describe('approximate — the locality the open feed shows', () => {
  it('drops the PIN code and keeps the last two named parts', async () => {
    const { approximateAddress: approximate } = await import('../../common/projections');
    expect(approximate('Iscon Mega Mall, S G Highway, Ramdev nagar, Vejalpur Taluka, Gujarat, 380015')).toBe('Vejalpur Taluka, Gujarat');
    expect(approximate('Law Garden, Gulbai tekra, Ahmedabad, Gujarat, 380006')).toBe('Ahmedabad, Gujarat');
    expect(approximate('Central Kolkata')).toBe('Central Kolkata');
  });
});

describe('TasksService.create — buying an item', () => {
  const delivery = { ...input, dropoffLocation, dropoffAddress: 'Manek Chowk, Old City, Ahmedabad' };

  it('holds the item budget apart from the task payment, with no receipt proof (the bill is approved instead)', async () => {
    const { service, taskCreate } = build('PICKUP_DROPOFF');
    await service.create('req-1', { ...delivery, budgetPaise: 20_000, itemBudgetPaise: 100_000 });
    const data = (taskCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    // Commission on the ₹200 task payment only, never on the ₹1,000 item.
    expect(data.budgetPaise).toBe(20_000);
    expect(data.commissionPaise).toBe(3_000);
    expect(data.workerPayoutPaise).toBe(17_000);
    expect(data.itemBudgetPaise).toBe(100_000);
    expect(JSON.stringify(data.proofRequirements)).not.toContain('item_receipt');
    // The verification level follows everything at stake: ₹1,200 needs level 2.
    expect(data.minVerificationLevel).toBe(2);
  });

  it('refuses an item budget on a one-place category, where there is nowhere to deliver it', async () => {
    const { service, taskCreate } = build('SINGLE');
    await expect(service.create('req-1', { ...input, itemBudgetPaise: 50_000 })).rejects.toThrow(BusinessRuleError);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('adds no receipt requirement when nothing is bought', async () => {
    const { service, taskCreate } = build('PICKUP_DROPOFF');
    await service.create('req-1', delivery);
    const data = (taskCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.itemBudgetPaise).toBe(0);
    expect(data.proofRequirements).toHaveLength(1);
  });
});

describe('TasksService.create — the "Other" category', () => {
  const other = { ...input, categorySlug: 'other' as const };

  it('stores the requester’s own label for an "Other" task', async () => {
    const { service, taskCreate } = build('SINGLE', 2_900, 'other');
    await service.create('req-1', { ...other, customCategoryLabel: '  Stand in a queue  ' });
    const data = (taskCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.customCategoryLabel).toBe('Stand in a queue');
  });

  it('needs a label for "Other"', async () => {
    const { service, taskCreate } = build('SINGLE', 2_900, 'other');
    await expect(service.create('req-1', other)).rejects.toThrow(BusinessRuleError);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('refuses a label on a named category, so a label cannot disguise one', async () => {
    const { service, taskCreate } = build('SINGLE', 2_900, 'product-inspection');
    await expect(
      service.create('req-1', { ...input, categorySlug: 'product-inspection', customCategoryLabel: 'Something else' }),
    ).rejects.toThrow(BusinessRuleError);
    expect(taskCreate).not.toHaveBeenCalled();
  });
});
