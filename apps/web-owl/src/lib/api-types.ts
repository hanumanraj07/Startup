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
 * What a requester pays: the task payment they set, any item budget, any
 * top-up paid to approve a bill above it, and the total. Once a bill is
 * approved, what the item cost and what comes back. The commission and the
 * worker's net earnings are never sent.
 */
export interface RequesterMoney {
  taskPaymentPaise: number;
  itemBudgetPaise: number;
  itemTopUpPaise: number;
  totalPaise: number;
  itemSpentPaise: number | null;
  itemRefundPaise: number | null;
}

/** One of GET /tasks/:id/purchases: a bill the worker sent from the shop (P6). */
export interface ItemBill {
  id: string;
  amountPaise: number;
  description: string;
  method: 'SHOP_UPI' | 'WORKER_CASH';
  merchantVpa: string | null;
  merchantName: string | null;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  expiresAt: string;
  decidedAt: string | null;
  rejectReason: string | null;
  topUpPaise: number;
  topUpPaid: boolean;
  shopPayment: { status: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'REVERSED'; reference: string | null; failureReason: string | null } | null;
  paidOut: boolean;
  createdAt: string;
  /** Short-lived presigned link to the bill photo. */
  billUrl?: string;
}

/** The item as the assigned worker sees it. Never part of earnings. */
export interface WorkerItem {
  /** Item budget plus any top-up. */
  budgetPaise: number;
  /** The approved bill, once there is one. */
  spentPaise: number | null;
  /** The most this worker may pay in cash at their level. */
  cashCapPaise: number;
  /** Whether OnSite can pay a shop's UPI ID directly. */
  shopPaymentAvailable: boolean;
  handoverConfirmed: boolean;
}

/** GET /tasks/:id as the task's owner (requester) sees it. */
export interface OwnerTask extends TaskBase {
  money: RequesterMoney;
  /** The item handover code, once a bill is approved. Never in the worker's view. */
  handover: { code: string; confirmed: boolean } | null;
  assignedWorker: { id: string; displayName: string; ratingAvg: number | null; tasksCompleted: number } | null;
  /** While a worker is being found: how many were sent the request, and how far out the search reaches. */
  matching: { workersNotified: number; radiusMeters: number } | null;
}

/** GET /tasks/:id as the assigned worker sees it: only their payout, never the budget or commission. */
export interface WorkerTask extends TaskBase {
  payoutPaise: number;
  /** An item to buy, or null. */
  item: WorkerItem | null;
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
  /** The bank or UPI check: VERIFIED is the only state payouts go to. */
  verificationStatus: 'PENDING' | 'VERIFIED' | 'FAILED' | 'NAME_MISMATCH';
  verificationFailureReason: string | null;
  /** The holder's name as the bank reports it (the worker's own record). */
  nameAtBank: string | null;
  bankName: string | null;
  createdAt: string;
}

/** GET /users/me/verification */
export interface VerificationStatus {
  provider: 'mock' | 'cashfree' | 'none';
  verificationLevel: number;
  identityVerified: boolean;
  identity: {
    id: string;
    status: 'PENDING' | 'VERIFIED' | 'CONSENT_DENIED' | 'EXPIRED' | 'FAILED';
    method: string;
    verifiedName: string | null;
    documentLast4: string | null;
    failureReason: string | null;
    expiresAt: string;
    completedAt: string | null;
  } | null;
  manualStatus: string | null;
  attemptsLeftToday: number;
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
  /** Payouts also wait for a verified identity (level 2+). */
  identityVerified: boolean;
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
