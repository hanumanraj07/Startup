/**
 * Additive-only reference data for a real deployment: categories and launch
 * cities. Unlike `seed.ts` (which deletes and recreates all demo data,
 * including every user), this touches nothing else — it upserts on the
 * unique keys (`Category.slug`, `City.[name, state]`) so it is safe to run
 * against a database that already has real signups.
 *
 * Run with: pnpm --filter @onsite/api exec ts-node prisma/seed-reference-data.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const KOLKATA = { lat: 22.5726, lng: 88.3639 };
const AHMEDABAD = { lat: 23.0225, lng: 72.5714 };

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

const CITIES = [
  { name: 'Kolkata', state: 'West Bengal', center: KOLKATA },
  { name: 'Ahmedabad', state: 'Gujarat', center: AHMEDABAD },
];

async function main() {
  console.log('Seeding reference data (categories, cities) — additive only…\n');

  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: {
        name: c.name,
        description: c.description,
        icon: c.icon,
        suggestedMinPaise: c.suggestedMinPaise,
        suggestedMaxPaise: c.suggestedMaxPaise,
        defaultProofRequirements: c.defaultProofRequirements as unknown as object,
        isActive: true,
      },
      create: {
        slug: c.slug,
        name: c.name,
        description: c.description,
        icon: c.icon,
        suggestedMinPaise: c.suggestedMinPaise,
        suggestedMaxPaise: c.suggestedMaxPaise,
        defaultProofRequirements: c.defaultProofRequirements as unknown as object,
        isActive: true,
      },
    });
  }
  console.log(`  Categories: ${CATEGORIES.length}`);

  for (const c of CITIES) {
    await prisma.city.upsert({
      where: { name_state: { name: c.name, state: c.state } },
      update: {
        centerLat: c.center.lat,
        centerLng: c.center.lng,
        radiusMeters: 40_000,
        isActive: true,
      },
      create: {
        name: c.name,
        state: c.state,
        centerLat: c.center.lat,
        centerLng: c.center.lng,
        radiusMeters: 40_000,
        isActive: true,
      },
    });
  }
  console.log(`  Cities:     ${CITIES.map((c) => c.name).join(', ')}`);

  console.log('\nDone.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
