/**
 * Seed data for OnSite.
 *
 * Two jobs:
 *
 *  1. Build the demo: the Ahmedabad-to-Kolkata MacBook inspection scenario from
 *     the founder document, so the whole product can be walked end to end.
 *
 *  2. Make the spatial layer testable. Four workers sit at KNOWN distances from
 *     the task location so ST_DWithin can be checked against arithmetic rather
 *     than hope, and 10,000 more are scattered across Kolkata because testing a
 *     geo index against thirty rows proves nothing.
 *
 * Run with: pnpm db:seed
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// ─── Reference points ────────────────────────────────────────────────────

/** The task location: the computer market area of central Kolkata. */
const TASK_LOCATION = { lat: 22.5675, lng: 88.351 };

const KOLKATA = { lat: 22.5726, lng: 88.3639 };
const AHMEDABAD = { lat: 23.0225, lng: 72.5714 };

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * Offsets a point north by a known number of metres.
 *
 * Latitude is used rather than longitude because degrees of latitude are very
 * nearly constant in length, which makes the resulting distances predictable
 * enough to assert against.
 */
function north(origin: { lat: number; lng: number }, meters: number) {
  return { lat: origin.lat + meters / METERS_PER_DEGREE_LAT, lng: origin.lng };
}

/** Deterministic PRNG, so a reseed produces an identical worker distribution. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const DEMO_PASSWORD = 'onsite-demo-password';

// ─── Categories ──────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    slug: 'product-inspection',
    name: 'Product inspection',
    description: 'Check a product in a shop before buying it remotely.',
    icon: 'package-search',
    suggestedMinPaise: 40_000n,
    suggestedMaxPaise: 120_000n,
    defaultProofRequirements: [
      { type: 'PHOTO', label: 'Photos of the product and its box', required: true, minCount: 3 },
      { type: 'VIDEO', label: 'Short video of the product', required: true, minCount: 1 },
      { type: 'STRUCTURED_FIELD', fieldKey: 'price', label: 'Final price quoted', required: true },
      {
        type: 'STRUCTURED_FIELD',
        fieldKey: 'serial_number',
        label: 'Serial number',
        required: true,
      },
      { type: 'NOTE', label: 'Notes from the shop', required: false },
    ],
  },
  {
    slug: 'shop-verification',
    name: 'Shop and business verification',
    description: 'Confirm a business exists and is operating at its stated address.',
    icon: 'store',
    suggestedMinPaise: 30_000n,
    suggestedMaxPaise: 100_000n,
    defaultProofRequirements: [
      { type: 'PHOTO', label: 'Photos of the premises and signage', required: true, minCount: 3 },
      { type: 'VIDEO', label: 'Short walkthrough', required: false, minCount: 1 },
      { type: 'NOTE', label: 'What you observed', required: true },
    ],
  },
  {
    slug: 'property-inspection',
    name: 'Property inspection',
    description: 'Visit a property and record its condition.',
    icon: 'home',
    suggestedMinPaise: 80_000n,
    suggestedMaxPaise: 250_000n,
    defaultProofRequirements: [
      { type: 'PHOTO', label: 'Photos of every room', required: true, minCount: 6 },
      { type: 'VIDEO', label: 'Video walkthrough', required: true, minCount: 1 },
      { type: 'NOTE', label: 'Condition notes', required: true },
    ],
  },
  {
    slug: 'document-collection',
    name: 'Document collection',
    description: 'Collect documents from an office and confirm handover.',
    icon: 'file-text',
    suggestedMinPaise: 40_000n,
    suggestedMaxPaise: 150_000n,
    defaultProofRequirements: [
      { type: 'PHOTO', label: 'Photo of the collected documents', required: true, minCount: 2 },
      { type: 'SIGNATURE', label: 'Handover confirmation', required: true },
      { type: 'NOTE', label: 'Collection notes', required: false },
    ],
  },
  {
    slug: 'local-photography',
    name: 'Local photography',
    description: 'Photograph a location, a site, or a signboard.',
    icon: 'camera',
    suggestedMinPaise: 30_000n,
    suggestedMaxPaise: 100_000n,
    defaultProofRequirements: [
      { type: 'PHOTO', label: 'Photographs as briefed', required: true, minCount: 5 },
      { type: 'NOTE', label: 'Notes', required: false },
    ],
  },
  {
    slug: 'local-research',
    name: 'Local research',
    description: 'Visit a place, ask specified questions, report the answers.',
    icon: 'search',
    suggestedMinPaise: 30_000n,
    suggestedMaxPaise: 120_000n,
    defaultProofRequirements: [
      { type: 'NOTE', label: 'Answers to the questions asked', required: true },
      { type: 'PHOTO', label: 'Supporting photographs', required: true, minCount: 2 },
    ],
  },
] as const;

// ─── Seed ────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding OnSite…\n');

  // Idempotent: clear in dependency order so a reseed is repeatable.
  await prisma.$transaction([
    prisma.ledgerEntry.deleteMany(),
    prisma.payout.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.taskProof.deleteMany(),
    prisma.arrivalRecord.deleteMany(),
    prisma.message.deleteMany(),
    prisma.taskOffer.deleteMany(),
    prisma.taskStatusHistory.deleteMany(),
    prisma.review.deleteMany(),
    prisma.disputeStatement.deleteMany(),
    prisma.dispute.deleteMany(),
    prisma.report.deleteMany(),
    prisma.task.deleteMany(),
    prisma.workerCategory.deleteMany(),
    prisma.workerProfile.deleteMany(),
    prisma.kycSubmission.deleteMany(),
    prisma.payoutAccount.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.otpCode.deleteMany(),
    prisma.pushSubscription.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.user.deleteMany(),
    prisma.category.deleteMany(),
    prisma.city.deleteMany(),
  ]);

  // Cities — the launch scope, enforced in data.
  const [kolkata, ahmedabad] = await Promise.all([
    prisma.city.create({
      data: {
        name: 'Kolkata',
        state: 'West Bengal',
        centerLat: KOLKATA.lat,
        centerLng: KOLKATA.lng,
        radiusMeters: 40_000,
        isActive: true,
      },
    }),
    prisma.city.create({
      data: {
        name: 'Ahmedabad',
        state: 'Gujarat',
        centerLat: AHMEDABAD.lat,
        centerLng: AHMEDABAD.lng,
        radiusMeters: 40_000,
        isActive: true,
      },
    }),
  ]);
  console.log(`  Cities:     ${[kolkata.name, ahmedabad.name].join(', ')}`);

  // Categories.
  const categories = await Promise.all(
    CATEGORIES.map((c) =>
      prisma.category.create({
        data: {
          slug: c.slug,
          name: c.name,
          description: c.description,
          icon: c.icon,
          suggestedMinPaise: c.suggestedMinPaise,
          suggestedMaxPaise: c.suggestedMaxPaise,
          defaultProofRequirements: c.defaultProofRequirements as unknown as object,
          isActive: true,
        },
      }),
    ),
  );
  const inspection = categories.find((c) => c.slug === 'product-inspection')!;
  console.log(`  Categories: ${categories.length}`);

  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  // Admin.
  await prisma.user.create({
    data: {
      email: 'admin@onsite.local',
      emailVerifiedAt: new Date(),
      phone: '+919000000000',
      phoneVerifiedAt: new Date(),
      passwordHash,
      displayName: 'OnSite Admin',
      platformRole: 'ADMIN',
      verificationLevel: 5,
      homeCity: 'Ahmedabad',
    },
  });

  // The requester, in Ahmedabad. Note the home location is 1,600 km from the
  // task: that separation is the entire point of the product, and matching
  // must never touch it.
  const requester = await prisma.user.create({
    data: {
      email: 'requester@onsite.local',
      emailVerifiedAt: new Date(),
      phone: '+919000000001',
      phoneVerifiedAt: new Date(),
      passwordHash,
      displayName: 'Hanuman R.',
      homeCity: 'Ahmedabad',
      homeAddress: 'Satellite, Ahmedabad',
      homeLat: AHMEDABAD.lat,
      homeLng: AHMEDABAD.lng,
      verificationLevel: 2,
    },
  });

  // Named workers at KNOWN distances from the task location. The geo test
  // asserts against these numbers, so they must not be randomised.
  const namedWorkers = [
    { name: 'Rahul S.', meters: 2_100, level: 2, rating: 4.9, completed: 187, rate: 98.4 },
    { name: 'Amit K.', meters: 3_700, level: 2, rating: 4.6, completed: 54, rate: 94.1 },
    { name: 'Priya D.', meters: 5_200, level: 2, rating: 4.8, completed: 96, rate: 97.0 },
    // Deliberately outside a 10 km search, to prove the radius actually excludes.
    { name: 'Sourav M.', meters: 14_800, level: 1, rating: 4.2, completed: 12, rate: 88.0 },
  ];

  const workerIds: string[] = [];
  for (const [i, w] of namedWorkers.entries()) {
    const at = north(TASK_LOCATION, w.meters);
    const user = await prisma.user.create({
      data: {
        email: `worker${i + 1}@onsite.local`,
        emailVerifiedAt: new Date(),
        phone: `+9190000001${String(i).padStart(2, '0')}`,
        phoneVerifiedAt: new Date(),
        passwordHash,
        displayName: w.name,
        homeCity: 'Kolkata',
        verificationLevel: w.level,
        workerProfile: {
          create: {
            baseLat: at.lat,
            baseLng: at.lng,
            baseCity: 'Kolkata',
            workingRadiusMeters: 15_000,
            isAvailable: true,
            ratingAvg: w.rating,
            ratingCount: Math.max(1, Math.round(w.completed * 0.8)),
            tasksCompleted: w.completed,
            tasksAccepted: Math.round(w.completed / (w.rate / 100)),
            tasksOffered: Math.round(w.completed * 2.4),
            completionRate: w.rate,
            responseRate: 62.5,
            lastActiveAt: new Date(),
          },
        },
      },
      include: { workerProfile: true },
    });
    workerIds.push(user.id);
    await prisma.workerCategory.create({
      data: { workerProfileId: user.workerProfile!.id, categoryId: inspection.id },
    });
  }
  console.log(`  Named workers at known distances: ${namedWorkers.map((w) => `${w.meters}m`).join(', ')}`);

  // Bulk workers, so the GIST index is exercised against a realistic row count.
  const BULK = 10_000;
  const rand = makeRandom(20260907);
  const bulkUsers: {
    id: string;
    email: string;
    displayName: string;
    passwordHash: string;
    homeCity: string;
    verificationLevel: number;
    emailVerifiedAt: Date;
  }[] = [];
  const bulkProfiles: {
    id: string;
    userId: string;
    baseLat: number;
    baseLng: number;
    baseCity: string;
    workingRadiusMeters: number;
    isAvailable: boolean;
    ratingAvg: number;
    ratingCount: number;
    tasksCompleted: number;
    tasksAccepted: number;
    tasksOffered: number;
    completionRate: number;
    responseRate: number;
    lastActiveAt: Date;
  }[] = [];
  const bulkLinks: { workerProfileId: string; categoryId: string }[] = [];

  for (let i = 0; i < BULK; i += 1) {
    const userId = randomUUID();
    const profileId = randomUUID();

    // Uniform over a disc of radius ~30 km around Kolkata. sqrt keeps the
    // distribution even rather than clustered at the centre.
    const radius = Math.sqrt(rand()) * 30_000;
    const angle = rand() * Math.PI * 2;
    const dLat = (radius * Math.cos(angle)) / METERS_PER_DEGREE_LAT;
    const dLng =
      (radius * Math.sin(angle)) / (METERS_PER_DEGREE_LAT * Math.cos((KOLKATA.lat * Math.PI) / 180));

    const completed = Math.floor(rand() * 120);
    bulkUsers.push({
      id: userId,
      email: `bulk${i}@onsite.local`,
      displayName: `Worker ${i}`,
      passwordHash,
      homeCity: 'Kolkata',
      verificationLevel: rand() > 0.35 ? 2 : 1,
      emailVerifiedAt: new Date(),
    });
    bulkProfiles.push({
      id: profileId,
      userId,
      baseLat: KOLKATA.lat + dLat,
      baseLng: KOLKATA.lng + dLng,
      baseCity: 'Kolkata',
      workingRadiusMeters: [5_000, 10_000, 15_000, 25_000][Math.floor(rand() * 4)] ?? 10_000,
      isAvailable: rand() > 0.3,
      ratingAvg: Math.round((3.5 + rand() * 1.5) * 100) / 100,
      ratingCount: Math.max(1, Math.floor(completed * 0.8)),
      tasksCompleted: completed,
      tasksAccepted: completed + Math.floor(rand() * 10),
      tasksOffered: completed * 2 + Math.floor(rand() * 30),
      completionRate: Math.round((80 + rand() * 20) * 10) / 10,
      responseRate: Math.round((30 + rand() * 60) * 10) / 10,
      lastActiveAt: new Date(Date.now() - Math.floor(rand() * 7 * 86_400_000)),
    });
    bulkLinks.push({
      workerProfileId: profileId,
      categoryId: categories[Math.floor(rand() * categories.length)]!.id,
    });
    // Most workers cover inspection, the launch category.
    if (rand() > 0.4) {
      bulkLinks.push({ workerProfileId: profileId, categoryId: inspection.id });
    }
  }

  await prisma.user.createMany({ data: bulkUsers });
  await prisma.workerProfile.createMany({ data: bulkProfiles });
  // Duplicates are possible where the random category is inspection.
  await prisma.workerCategory.createMany({ data: bulkLinks, skipDuplicates: true });
  console.log(`  Bulk workers: ${BULK} across Kolkata`);

  // The demo task, straight from the founder document.
  const budgetPaise = 50_000n;
  const commissionRateBps = 1_500;
  const commissionPaise = (budgetPaise * BigInt(commissionRateBps)) / 10_000n;

  const task = await prisma.task.create({
    data: {
      requesterId: requester.id,
      categoryId: inspection.id,
      cityId: kolkata.id,
      title: 'Inspect MacBook Air M4 at XYZ Computer Store',
      description: [
        'Please visit XYZ Computer Store in Chandni Chowk.',
        '',
        'Check whether the MacBook Air M4 16GB/512GB is available.',
        'Ask for the final price.',
        'Check whether the product is sealed.',
        'Take photos of the box.',
        'Record a short video.',
        'Note the serial number.',
        '',
        'Do NOT purchase it.',
      ].join('\n'),
      status: 'DRAFT',
      taskLat: TASK_LOCATION.lat,
      taskLng: TASK_LOCATION.lng,
      taskAddress: 'XYZ Computer Store, Chandni Chowk, Kolkata, West Bengal',
      taskPlaceName: 'XYZ Computer Store',
      // PRIVATE. Recorded, never exposed to a worker, never used for matching.
      requesterLat: AHMEDABAD.lat,
      requesterLng: AHMEDABAD.lng,
      budgetPaise,
      commissionRateBps,
      commissionPaise,
      workerPayoutPaise: budgetPaise - commissionPaise,
      deadlineAt: new Date(Date.now() + 8 * 3_600_000),
      proofRequirements: inspection.defaultProofRequirements as object,
      minVerificationLevel: 1,
      riskLevel: 'LOW',
      riskFlags: [],
      attachmentKeys: [],
    },
  });

  console.log(`\n  Demo task: ${task.title}`);
  console.log(`    Budget ₹500  ·  commission ₹75  ·  worker receives ₹425`);
  console.log(`    Task location:      Kolkata      (${TASK_LOCATION.lat}, ${TASK_LOCATION.lng})`);
  console.log(`    Requester location: Ahmedabad    (${AHMEDABAD.lat}, ${AHMEDABAD.lng})`);
  console.log('\n  Accounts (password: ' + DEMO_PASSWORD + ')');
  console.log('    admin@onsite.local      admin');
  console.log('    requester@onsite.local  Ahmedabad requester');
  console.log('    worker1@onsite.local    Kolkata worker, 2.1 km from the task');
  console.log('\nSeed complete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
