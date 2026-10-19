import type { CategorySlug, LocationMode, ProofType, TaskStatus } from '@onsite/types';

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
  /** SINGLE: one place. PICKUP_DROPOFF: collect at one place, hand over at another. */
  locationMode: LocationMode;
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
  /** The most the worker would spend on an item and get back, or 0. Not earnings. */
  itemBudgetPaise: number;
  deadlineAt: string;
  approximateAddress: string;
  /** Pickup & delivery tasks: roughly where it goes and how far. The exact drop-off is shown once accepted. */
  dropoff: { approximateAddress: string; tripDistanceMeters: number } | null;
  requester: { displayName: string; verificationLevel: number };
}

export interface FeedTask extends RawFeedItem {
  /** The category's lucide icon slug, joined in from GET /categories. */
  categoryIcon: string;
}

// ─── Tasks ──────────────────────────────────────────────────────────────

/** One row of GET /tasks/mine. */
export interface TaskListItem {
  id: string;
  title: string;
  categorySlug: string;
  status: TaskStatus;
  /** The requester's total to pay, or the worker's earnings: each side sees only its own figure. */
  amountPaise: number;
  deadlineAt: string;
  createdAt: string;
}

export interface StatusEvent {
  status: TaskStatus;
  at: string;
  actorRole: 'REQUESTER' | 'WORKER' | 'ADMIN' | 'SYSTEM';
  reason: string | null;
}

interface TaskBase {
  id: string;
  title: string;
  description: string;
  categoryName: string;
  status: TaskStatus;
  deadlineAt: string;
  proofRequirements: ProofRequirement[];
  statusHistory: StatusEvent[];
  locationMode: LocationMode;
  /** The task location; for pickup & delivery tasks, the pickup point. */
  location: { latitude: number; longitude: number; address: string };
  /** Pickup & delivery tasks only. */
  dropoff: { latitude: number; longitude: number; address: string } | null;
}

// ─── Places (map picker) ─────────────────────────────────────────────────

/** One GET /places/search result, or the GET /places/reverse result. A suggestion only. */
export interface PlaceView {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

/** A point the user settled on in the location picker, plus what they typed to help a worker find it. */
export interface PickedLocation {
  latitude: number;
  longitude: number;
  /** From search or the "what is here" lookup; empty when the provider had nothing. */
  suggestedAddress: string;
  /** Shop name, floor, landmark: free text from the user. */
  details: string;
}

/**
 * What a requester pays: the task payment they set, any item budget, and the
 * total. Once the worker reports the item's cost, what it cost and what comes
 * back. The commission and the worker's net earnings are never sent.
 */
export interface RequesterMoney {
  taskPaymentPaise: number;
  itemBudgetPaise: number;
  totalPaise: number;
  itemSpentPaise: number | null;
  itemRefundPaise: number | null;
}

/** GET /tasks/:id as the task's owner (requester) sees it. */
export interface OwnerTask extends TaskBase {
  money: RequesterMoney;
  assignedWorker: { id: string; displayName: string; ratingAvg: number | null; tasksCompleted: number } | null;
  /** While a worker is being found: how many were sent the request, and how far out the search reaches. */
  matching: { workersNotified: number; radiusMeters: number } | null;
}

/** GET /tasks/:id as the assigned worker sees it: only their payout, never the budget or commission. */
export interface WorkerTask extends TaskBase {
  payoutPaise: number;
  /** An item to buy and be reimbursed for, or null. Never part of earnings. */
  item: { budgetPaise: number; spentPaise: number | null } | null;
  requester: { displayName: string; verificationLevel: number };
}

export type TaskDetail = OwnerTask | WorkerTask;

export function isOwnerView(task: TaskDetail): task is OwnerTask {
  return 'money' in task;
}

export interface ProofView {
  id: string;
  type: 'PHOTO' | 'VIDEO' | 'NOTE' | 'STRUCTURED_FIELD' | 'SIGNATURE';
  url: string | null;
  fieldKey: string | null;
  fieldValue: string | null;
  noteBody: string | null;
  capturedAt: string | null;
  uploadedAt: string;
  distanceFromTaskMeters: number | null;
  verificationFlags: string[];
}

export interface ChatMessage {
  id: string;
  senderId: string;
  isMine: boolean;
  body: string;
  redactionFlags: string[];
  createdAt: string;
  readAt: string | null;
}

// ─── Payouts ────────────────────────────────────────────────────────────

/** One of GET /users/me/payout-accounts. Never the PAN, never a full account number. */
export interface PayoutAccountView {
  id: string;
  type: 'BANK' | 'UPI';
  accountHolderName: string | null;
  accountNumberMasked: string | null;
  ifsc: string | null;
  upiVpa: string | null;
  isVerified: boolean;
  isDefault: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

/** GET /payouts/summary */
export interface PayoutSummary {
  provider: 'mock' | 'none';
  availablePaise: number;
  processingPaise: number;
  paidPaise: number;
  earnedPaise: number;
  reimbursedPaise: number;
  failedCount: number;
  account: { id: string; type: 'BANK' | 'UPI'; label: string } | null;
}

/** One row of GET /payouts/mine. */
export interface PayoutRow {
  id: string;
  taskId: string;
  taskTitle: string;
  amountPaise: number;
  earningsPaise: number;
  reimbursementPaise: number;
  status: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'REVERSED';
  failureReason: string | null;
  reference: string | null;
  destination: string | null;
  processedAt: string | null;
  createdAt: string;
}
