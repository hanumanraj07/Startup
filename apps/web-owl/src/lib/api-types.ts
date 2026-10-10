import type { CategorySlug, ProofType, TaskStatus } from '@onsite/types';

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

// ─── Tasks ──────────────────────────────────────────────────────────────

/** One row of GET /tasks/mine. */
export interface TaskListItem {
  id: string;
  title: string;
  categorySlug: string;
  status: TaskStatus;
  budgetPaise: number;
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
  location: { latitude: number; longitude: number; address: string };
}

/** GET /tasks/:id as the task's owner (requester) sees it: the money breakdown, never a worker payout alone. */
export interface OwnerTask extends TaskBase {
  money: { budgetPaise: number; commissionPaise: number; workerPayoutPaise: number };
  assignedWorker: { id: string; displayName: string; ratingAvg: number | null; tasksCompleted: number } | null;
}

/** GET /tasks/:id as the assigned worker sees it: only their payout, never the budget or commission. */
export interface WorkerTask extends TaskBase {
  payoutPaise: number;
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
