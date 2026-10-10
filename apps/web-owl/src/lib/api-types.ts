import type { CategorySlug, ProofType } from '@onsite/types';

export interface ProofRequirement {
  type: ProofType;
  label: string;
  required: boolean;
  fieldKey?: string;
  minCount?: number;
}

export interface CategoryView {
  id: string;
  slug: CategorySlug;
  name: string;
  description: string;
  icon: string;
  suggestedMinPaise: number;
  suggestedMaxPaise: number;
  defaultProofRequirements: ProofRequirement[];
}

export interface CityView {
  id: string;
  name: string;
  state: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

/** GET /workers/me */
export interface WorkerProfile {
  id: string;
  baseLocation: { latitude: number; longitude: number };
  baseCity: string;
  workingRadiusMeters: number;
  isAvailable: boolean;
  categories: { slug: string; name: string }[];
}

/** One item of GET /tasks/nearby, as the API returns it (before the category icon is joined in). */
export interface RawFeedItem {
  id: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  distanceMeters: number;
  distanceLabel: string;
  payoutPaise: number;
  deadlineAt: string;
  approximateAddress: string;
  requester: { displayName: string; verificationLevel: number };
}

export interface FeedTask extends RawFeedItem {
  /** The category's lucide icon slug, joined in from GET /categories. */
  categoryIcon: string;
}
