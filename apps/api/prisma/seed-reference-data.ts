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

// India-wide launch: at least one city per state/UT, plus a couple of extra
// entries in the most populous states for better "nearest city" granularity.
// These rows do not gate task creation (see geo.repository.ts findNearestCity)
// — they only power the state -> city picker and the display label attached
// to a task. A 40km label radius is a reasonable "city area" for that.
const CITIES = [
  { name: 'Visakhapatnam', state: 'Andhra Pradesh', center: { lat: 17.6868, lng: 83.2185 } },
  { name: 'Vijayawada', state: 'Andhra Pradesh', center: { lat: 16.5062, lng: 80.648 } },
  { name: 'Itanagar', state: 'Arunachal Pradesh', center: { lat: 27.0844, lng: 93.6053 } },
  { name: 'Guwahati', state: 'Assam', center: { lat: 26.1445, lng: 91.7362 } },
  { name: 'Patna', state: 'Bihar', center: { lat: 25.5941, lng: 85.1376 } },
  { name: 'Raipur', state: 'Chhattisgarh', center: { lat: 21.2514, lng: 81.6296 } },
  { name: 'Panaji', state: 'Goa', center: { lat: 15.4909, lng: 73.8278 } },
  { name: 'Ahmedabad', state: 'Gujarat', center: { lat: 23.0225, lng: 72.5714 } },
  { name: 'Surat', state: 'Gujarat', center: { lat: 21.1702, lng: 72.8311 } },
  { name: 'Gurugram', state: 'Haryana', center: { lat: 28.4595, lng: 77.0266 } },
  { name: 'Faridabad', state: 'Haryana', center: { lat: 28.4089, lng: 77.3178 } },
  { name: 'Shimla', state: 'Himachal Pradesh', center: { lat: 31.1048, lng: 77.1734 } },
  { name: 'Ranchi', state: 'Jharkhand', center: { lat: 23.3441, lng: 85.3096 } },
  { name: 'Bengaluru', state: 'Karnataka', center: { lat: 12.9716, lng: 77.5946 } },
  { name: 'Mysuru', state: 'Karnataka', center: { lat: 12.2958, lng: 76.6394 } },
  { name: 'Kochi', state: 'Kerala', center: { lat: 9.9312, lng: 76.2673 } },
  { name: 'Thiruvananthapuram', state: 'Kerala', center: { lat: 8.5241, lng: 76.9366 } },
  { name: 'Bhopal', state: 'Madhya Pradesh', center: { lat: 23.2599, lng: 77.4126 } },
  { name: 'Indore', state: 'Madhya Pradesh', center: { lat: 22.7196, lng: 75.8577 } },
  { name: 'Mumbai', state: 'Maharashtra', center: { lat: 19.076, lng: 72.8777 } },
  { name: 'Pune', state: 'Maharashtra', center: { lat: 18.5204, lng: 73.8567 } },
  { name: 'Nagpur', state: 'Maharashtra', center: { lat: 21.1458, lng: 79.0882 } },
  { name: 'Imphal', state: 'Manipur', center: { lat: 24.817, lng: 93.9368 } },
  { name: 'Shillong', state: 'Meghalaya', center: { lat: 25.5788, lng: 91.8933 } },
  { name: 'Aizawl', state: 'Mizoram', center: { lat: 23.7271, lng: 92.7176 } },
  { name: 'Kohima', state: 'Nagaland', center: { lat: 25.6751, lng: 94.1086 } },
  { name: 'Bhubaneswar', state: 'Odisha', center: { lat: 20.2961, lng: 85.8245 } },
  { name: 'Ludhiana', state: 'Punjab', center: { lat: 30.901, lng: 75.8573 } },
  { name: 'Amritsar', state: 'Punjab', center: { lat: 31.634, lng: 74.8723 } },
  { name: 'Jaipur', state: 'Rajasthan', center: { lat: 26.9124, lng: 75.7873 } },
  { name: 'Jodhpur', state: 'Rajasthan', center: { lat: 26.2389, lng: 73.0243 } },
  { name: 'Gangtok', state: 'Sikkim', center: { lat: 27.3389, lng: 88.6065 } },
  { name: 'Chennai', state: 'Tamil Nadu', center: { lat: 13.0827, lng: 80.2707 } },
  { name: 'Coimbatore', state: 'Tamil Nadu', center: { lat: 11.0168, lng: 76.9558 } },
  { name: 'Hyderabad', state: 'Telangana', center: { lat: 17.385, lng: 78.4867 } },
  { name: 'Agartala', state: 'Tripura', center: { lat: 23.8315, lng: 91.2868 } },
  { name: 'Lucknow', state: 'Uttar Pradesh', center: { lat: 26.8467, lng: 80.9462 } },
  { name: 'Kanpur', state: 'Uttar Pradesh', center: { lat: 26.4499, lng: 80.3319 } },
  { name: 'Noida', state: 'Uttar Pradesh', center: { lat: 28.5355, lng: 77.391 } },
  { name: 'Dehradun', state: 'Uttarakhand', center: { lat: 30.3165, lng: 78.0322 } },
  { name: 'Kolkata', state: 'West Bengal', center: { lat: 22.5726, lng: 88.3639 } },
  { name: 'New Delhi', state: 'Delhi', center: { lat: 28.6139, lng: 77.209 } },
  { name: 'Srinagar', state: 'Jammu and Kashmir', center: { lat: 34.0837, lng: 74.7973 } },
  { name: 'Jammu', state: 'Jammu and Kashmir', center: { lat: 32.7266, lng: 74.857 } },
  { name: 'Leh', state: 'Ladakh', center: { lat: 34.1526, lng: 77.5771 } },
  { name: 'Puducherry', state: 'Puducherry', center: { lat: 11.9416, lng: 79.8083 } },
  { name: 'Chandigarh', state: 'Chandigarh', center: { lat: 30.7333, lng: 76.7794 } },
  { name: 'Port Blair', state: 'Andaman and Nicobar Islands', center: { lat: 11.6234, lng: 92.7265 } },
  { name: 'Daman', state: 'Dadra and Nagar Haveli and Daman and Diu', center: { lat: 20.3974, lng: 72.8328 } },
  { name: 'Kavaratti', state: 'Lakshadweep', center: { lat: 10.5593, lng: 72.6358 } },
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
