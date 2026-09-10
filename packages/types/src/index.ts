/**
 * Shared domain types for OnSite.
 *
 * Imported by both the API and the web app so a type is never defined twice
 * and cannot drift. Must stay runtime-neutral: no Node built-ins, no DOM
 * assumptions, so a React Native app could consume this unchanged.
 *
 * The database schema this mirrors is specified in docs/06-database-design.md.
 */

// ─── Enums ───────────────────────────────────────────────────────────────

/** See docs/09-task-lifecycle.md for the transition table. */
export const TASK_STATUS = [
  'DRAFT',
  'PUBLISHED',
  'MATCHING',
  'ASSIGNED',
  'WORKER_EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'COMPLETED',
  'PAYMENT_RELEASED',
  'DISPUTED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

/** Statuses in which a task is visible in the worker feed. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['PUBLISHED', 'MATCHING'];

/** Statuses from which no further transition is possible. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = [
  'PAYMENT_RELEASED',
  'CANCELLED',
  'EXPIRED',
];

/** Statuses in which the assigned worker is actively executing. */
export const ACTIVE_WORK_STATUSES: readonly TaskStatus[] = [
  'ASSIGNED',
  'WORKER_EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
];

export const USER_STATUS = ['ACTIVE', 'SUSPENDED', 'BANNED'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const PLATFORM_ROLE = ['USER', 'ADMIN'] as const;
export type PlatformRole = (typeof PLATFORM_ROLE)[number];

/** See docs/12-trust-safety.md. Enforced server-side at task acceptance. */
export type VerificationLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const PROOF_TYPE = ['PHOTO', 'VIDEO', 'NOTE', 'STRUCTURED_FIELD', 'SIGNATURE'] as const;
export type ProofType = (typeof PROOF_TYPE)[number];

export const PAYMENT_STATUS = [
  'CREATED',
  'AUTHORIZED',
  'CAPTURED',
  'HELD',
  'RELEASED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'FAILED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export const PAYOUT_STATUS = [
  'PENDING',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'REVERSED',
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUS)[number];

export const DISPUTE_STATUS = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'WITHDRAWN'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUS)[number];

export const DISPUTE_RESOLUTION = [
  'RELEASE_TO_WORKER',
  'REFUND_TO_REQUESTER',
  'SPLIT',
] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTION)[number];

export const RISK_LEVEL = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVEL)[number];

export const KYC_STATUS = ['PENDING', 'APPROVED', 'REJECTED', 'RESUBMIT'] as const;
export type KycStatus = (typeof KYC_STATUS)[number];

/** Launch categories only. Widening this is a product decision, see docs/17-mvp-scope.md. */
export const CATEGORY_SLUG = [
  'product-inspection',
  'shop-verification',
  'property-inspection',
  'document-collection',
  'local-photography',
  'local-research',
] as const;
export type CategorySlug = (typeof CATEGORY_SLUG)[number];

/** Ledger accounts. Entries for a task must sum to zero. See docs/11-payment-flow.md. */
export const LEDGER_ACCOUNT = [
  'REQUESTER_FUNDS',
  'ESCROW',
  'PLATFORM_COMMISSION',
  'WORKER_PAYABLE',
  'WORKER_SETTLED',
  'GATEWAY_FEE',
  'GST_PAYABLE',
  'TCS_PAYABLE',
  'TDS_PAYABLE',
  'REFUND',
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNT)[number];

export const LEDGER_ENTRY_TYPE = [
  'CAPTURE',
  'COMMISSION',
  'RELEASE',
  'REFUND',
  'PAYOUT',
  'FEE',
  'TAX',
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPE)[number];

/** Flags recorded against proof. These surface to the requester; they never silently block. */
export const PROOF_VERIFICATION_FLAG = [
  'gps_outside_geofence',
  'timestamp_implausible',
  'missing_exif',
  'uploaded_long_after_capture',
] as const;
export type ProofVerificationFlag = (typeof PROOF_VERIFICATION_FLAG)[number];

// ─── Geography ───────────────────────────────────────────────────────────

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface GeoPoint extends Coordinates {
  /** Reported accuracy in metres, where the client provides it. */
  accuracyMeters?: number;
}

// ─── Projections ─────────────────────────────────────────────────────────
// Every API response is built from one of these. A Prisma entity is never
// serialized directly. See docs/07-api-specification.md.

/**
 * The only shape in which one marketplace party ever sees another.
 *
 * Deliberately contains no phone, email, address, coordinates, KYC or bank
 * data. Asserted by snapshot tests over whole response bodies.
 */
export interface PublicUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  homeCity: string | null;
  verificationLevel: VerificationLevel;
  memberSince: string;
}

export interface PublicWorker extends PublicUser {
  ratingAvg: number | null;
  ratingCount: number;
  tasksCompleted: number;
  completionRate: number | null;
}

/** The authenticated user's own record. Never returned for any other user. */
export interface SelfUser extends PublicUser {
  email: string;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  platformRole: PlatformRole;
  status: UserStatus;
  hasWorkerProfile: boolean;
}

export interface TaskLocation {
  latitude: number;
  longitude: number;
  address: string;
  placeName: string | null;
  city: string;
}

/** Shown to a worker browsing the feed, before assignment. */
export interface TaskFeedItem {
  id: string;
  title: string;
  categorySlug: CategorySlug;
  /** Server-computed with PostGIS. The client never calculates this. */
  distanceMeters: number;
  /** What the worker receives, not the requester's budget. */
  payoutPaise: number;
  deadlineAt: string;
  /** Approximate until assignment; exact coordinates are revealed on accept. */
  approximateLocation: TaskLocation;
  requester: PublicUser & { ratingAvg: number | null };
  proofRequirements: ProofRequirement[];
}

export interface ProofRequirement {
  type: ProofType;
  /** Structured fields carry a key, such as "serial_number". */
  fieldKey?: string;
  label: string;
  required: boolean;
  minCount?: number;
}

export interface TaskProof {
  id: string;
  type: ProofType;
  /** Short-lived presigned URL. Never a permanent public link. */
  url: string | null;
  fieldKey: string | null;
  fieldValue: string | null;
  noteBody: string | null;
  capturedAt: string | null;
  uploadedAt: string;
  /** Measured server-side against the task location. */
  distanceFromTaskMeters: number | null;
  verificationFlags: ProofVerificationFlag[];
}

export interface TaskStatusEvent {
  status: TaskStatus;
  at: string;
  actorRole: 'REQUESTER' | 'WORKER' | 'ADMIN' | 'SYSTEM';
  reason: string | null;
}

export interface MoneyBreakdown {
  budgetPaise: number;
  commissionPaise: number;
  workerPayoutPaise: number;
}

/** The requester's full view of their own task. */
export interface TaskDetail {
  id: string;
  title: string;
  description: string;
  categorySlug: CategorySlug;
  status: TaskStatus;
  location: TaskLocation;
  money: MoneyBreakdown;
  deadlineAt: string;
  reviewDeadlineAt: string | null;
  proofRequirements: ProofRequirement[];
  proofs: TaskProof[];
  statusHistory: TaskStatusEvent[];
  assignedWorker: PublicWorker | null;
  riskLevel: RiskLevel;
  createdAt: string;
}

export interface Message {
  id: string;
  taskId: string;
  senderId: string;
  /** Already redacted server-side. The raw body is never sent to a client. */
  body: string;
  redactionFlags: string[];
  attachmentUrl: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface TrustProfile {
  user: PublicWorker;
  verificationLevel: VerificationLevel;
  emailVerified: boolean;
  phoneVerified: boolean;
  identityVerified: boolean;
  addressVerified: boolean;
  tasksCompleted: number;
  completionRate: number | null;
  responseRate: number | null;
  memberSince: string;
}

// ─── API envelopes ───────────────────────────────────────────────────────

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface Paginated<T> {
  data: T[];
  nextCursor: string | null;
}
