import { describe, expect, it, vi } from 'vitest';
import { TasksService } from './tasks.service';
import { NotFoundError } from '../../common/errors';

/**
 * docs/16-security-requirements.md: "Cross-party PII is blocked by explicit
 * projections, and asserted by tests over whole response bodies so a column
 * added later cannot leak quietly." docs/12-trust-safety.md's exact list:
 * "The requester never receives: the worker's home address, coordinates,
 * phone number, email, KYC documents or bank details. The worker never
 * receives: the requester's home address, coordinates, phone number or
 * email."
 *
 * The fake task/user rows below are deliberately "kitchen sink" — every
 * sensitive field that exists on the real Prisma models, including ones no
 * current code path reads. That is the point: this test asserts the EXACT
 * key set of the returned object (`Object.keys(...).sort()`), not merely
 * that a couple of named fields are absent. A future column added to the
 * schema and carelessly spread into one of TasksService.getById's two
 * projections fails this test immediately, rather than leaking quietly
 * until a person notices in production.
 */

function fakePrisma(task: Record<string, unknown> | null) {
  return { task: { findUnique: vi.fn().mockResolvedValue(task) } };
}

const REQUESTER_ID = 'req-1';
const WORKER_ID = 'worker-1';
const OUTSIDER_ID = 'outsider-1';

function fakeTask() {
  return {
    id: 't1',
    requesterId: REQUESTER_ID,
    assignedWorkerId: WORKER_ID,
    title: 'Inspect a laptop',
    description: 'Full description with instructions',
    status: 'ASSIGNED',
    deadlineAt: new Date('2026-09-08T00:00:00Z'),
    reviewDeadlineAt: null,
    proofRequirements: [{ type: 'PHOTO', label: 'Photo', required: true }],
    riskLevel: 'LOW',
    createdAt: new Date('2026-09-07T00:00:00Z'),
    taskLat: 22.5675,
    taskLng: 88.351,
    taskAddress: 'Computer market, Kolkata',
    budgetPaise: 50_000n,
    commissionPaise: 7_500n,
    workerPayoutPaise: 42_500n,
    category: { slug: 'product-inspection', name: 'Product inspection' },
    statusHistory: [{ toStatus: 'ASSIGNED', createdAt: new Date(), actorRole: 'WORKER', reason: null }],
    // The full requester row — every PII field a real User row carries.
    requester: {
      id: REQUESTER_ID,
      displayName: 'Hanuman R.',
      verificationLevel: 2,
      email: 'requester@onsite.local',
      phone: '+919000000001',
      passwordHash: 'argon2id$...',
      homeAddress: 'Satellite, Ahmedabad',
      homeLat: 23.0225,
      homeLng: 72.5714,
      homeCity: 'Ahmedabad',
      avatarUrl: null,
    },
    // The full assigned-worker row, including its workerProfile — every PII
    // and KYC-adjacent field a real row carries.
    assignedWorker: {
      id: WORKER_ID,
      displayName: 'Rahul S.',
      verificationLevel: 2,
      email: 'worker1@onsite.local',
      phone: '+919000000100',
      passwordHash: 'argon2id$...',
      homeAddress: null,
      homeLat: null,
      homeLng: null,
      homeCity: 'Kolkata',
      avatarUrl: null,
      workerProfile: {
        ratingAvg: 4.9,
        tasksCompleted: 187,
        baseLat: 22.57,
        baseLng: 88.35,
        workingRadiusMeters: 15_000,
      },
    },
  };
}

describe('TasksService.getById — PII projection snapshot', () => {
  it("the owner's (requester's) view exposes exactly the expected keys, and no worker PII", async () => {
    const { client } = { client: fakePrisma(fakeTask()) };
    const service = new TasksService(
      client as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.getById('t1', REQUESTER_ID);

    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'title',
        'description',
        'categorySlug',
        'categoryName',
        'status',
        'deadlineAt',
        'reviewDeadlineAt',
        'proofRequirements',
        'riskLevel',
        'createdAt',
        'statusHistory',
        'location',
        'money',
        'assignedWorker',
      ].sort(),
    );

    // The worker sub-object: exactly rating/completions/identity, never PII.
    // Cast needed: getById's two role branches return different shapes, and
    // this test already established (via the exact key-set assertion above)
    // that the owner branch, with its `assignedWorker` key, is what came back.
    const owned = result as { assignedWorker: Record<string, unknown> };
    expect(Object.keys(owned.assignedWorker).sort()).toEqual(
      ['id', 'displayName', 'verificationLevel', 'ratingAvg', 'tasksCompleted'].sort(),
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('worker1@onsite.local'); // worker email
    expect(serialized).not.toContain('+919000000100'); // worker phone
    expect(serialized).not.toContain('argon2id'); // no password hash, from either party
    expect(serialized).not.toContain('22.57'); // worker's base coordinates (workerProfile.baseLat)
  });

  it("the assigned worker's view exposes exactly the expected keys, and no requester PII, and never the budget or commission", async () => {
    const { client } = { client: fakePrisma(fakeTask()) };
    const service = new TasksService(
      client as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.getById('t1', WORKER_ID);

    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'title',
        'description',
        'categorySlug',
        'categoryName',
        'status',
        'deadlineAt',
        'reviewDeadlineAt',
        'proofRequirements',
        'riskLevel',
        'createdAt',
        'statusHistory',
        'location',
        'payoutPaise',
        'requester',
      ].sort(),
    );

    // The requester sub-object: exactly identity, never contact info or home
    // location. Cast for the same reason as the owner-view test above.
    const workerView = result as { requester: Record<string, unknown> };
    expect(Object.keys(workerView.requester).sort()).toEqual(['displayName', 'verificationLevel'].sort());

    expect(result).not.toHaveProperty('money');
    expect(result).not.toHaveProperty('budgetPaise');
    expect(result).not.toHaveProperty('commissionPaise');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('requester@onsite.local'); // requester email
    expect(serialized).not.toContain('+919000000001'); // requester phone
    expect(serialized).not.toContain('Satellite, Ahmedabad'); // requester home address
    expect(serialized).not.toContain('23.0225'); // requester home coordinates
    expect(serialized).not.toContain('argon2id'); // no password hash, from either party
    expect(serialized).not.toContain('50000'); // the budget, in paise
    expect(serialized).not.toContain('7500'); // the commission, in paise
  });

  it('a party with no relationship to the task gets NotFoundError, not a 403 — existence itself is not information they need', async () => {
    const { client } = { client: fakePrisma(fakeTask()) };
    const service = new TasksService(
      client as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.getById('t1', OUTSIDER_ID)).rejects.toThrow(NotFoundError);
  });
});
