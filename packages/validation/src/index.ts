/**
 * Shared Zod schemas.
 *
 * The API validates every request body against these, and the web app
 * validates every form against the same schemas. Sharing them is what stops
 * client and server disagreeing about what is valid.
 *
 * Runtime-neutral: no Node built-ins, no DOM assumptions.
 */
import { z } from 'zod';
import { CATEGORY_SLUG, PROOF_TYPE } from '@onsite/types';

// ─── Primitives ──────────────────────────────────────────────────────────

export const uuidSchema = z.string().uuid('Must be a valid identifier');

/** Indian mobile numbers in E.164. */
export const phoneSchema = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Enter a valid Indian mobile number');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

/**
 * Length over composition rules. Forcing a symbol and a digit pushes people
 * toward "Password1!", which is worse than a longer passphrase.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That is longer than necessary');

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const coordinatesSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

export const geoPointSchema = coordinatesSchema.extend({
  accuracyMeters: z.number().nonnegative().max(100_000).optional(),
});

/** Money always arrives as integer paise, never rupees and never a float. */
export const paiseSchema = z
  .number()
  .int('Amounts must be whole paise')
  .nonnegative('Amounts cannot be negative')
  .max(Number.MAX_SAFE_INTEGER);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(500).optional(),
});

// GET /tasks/mine defaults to the caller's posted (requester) tasks; a worker
// viewing their own accepted work passes perspective=worker to switch which
// column the query filters on. Additive, not a new endpoint.
export const myTasksSchema = paginationSchema.extend({
  perspective: z.enum(['requester', 'worker']).default('requester'),
});
export type MyTasksInput = z.infer<typeof myTasksSchema>;

// ─── Auth ────────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2, 'Enter your name').max(80),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});

export const googleAuthSchema = z.object({
  idToken: z.string().min(1),
});

export const sendOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

// ─── Profile ─────────────────────────────────────────────────────────────

// The literal-text confirmation is required even for a Google-only account
// with no password, so deletion always needs a deliberate, typed act — not
// just a click that a script or a mis-tap could trigger.
export const deleteAccountSchema = z.object({
  confirm: z.literal('DELETE', { errorMap: () => ({ message: 'Type DELETE to confirm.' }) }),
  password: z.string().min(1).optional(),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  homeCity: z.string().trim().max(80).nullable().optional(),
  homeAddress: z.string().trim().max(500).nullable().optional(),
  homeLocation: coordinatesSchema.nullable().optional(),
});

export const workerProfileSchema = z.object({
  baseLocation: coordinatesSchema,
  baseCity: z.string().trim().min(2).max(80),
  workingRadiusMeters: z.number().int().min(1_000).max(50_000),
  categorySlugs: z.array(z.enum(CATEGORY_SLUG)).min(1, 'Choose at least one category'),
});

export const availabilitySchema = z.object({
  isAvailable: z.boolean(),
});

export const kycSubmissionSchema = z.object({
  documentType: z.enum(['AADHAAR', 'PAN', 'DRIVING_LICENCE', 'VOTER_ID', 'PASSPORT']),
  documentNumber: z.string().trim().min(4).max(40),
  documentFrontKey: z.string().min(1).max(500),
  documentBackKey: z.string().min(1).max(500).optional(),
  selfieKey: z.string().min(1).max(500),
});

export const kycPresignSchema = z.object({
  kind: z.enum(['front', 'back', 'selfie']),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

export const payoutAccountSchema = z
  .object({
    type: z.enum(['BANK', 'UPI']),
    accountNumber: z.string().trim().min(6).max(30).optional(),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code')
      .optional(),
    upiVpa: z
      .string()
      .trim()
      .regex(/^[\w.-]{2,64}@[a-zA-Z]{2,64}$/, 'Enter a valid UPI ID')
      .optional(),
    panNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN'),
  })
  .refine((v) => (v.type === 'BANK' ? Boolean(v.accountNumber && v.ifsc) : Boolean(v.upiVpa)), {
    message: 'Provide bank account and IFSC, or a UPI ID',
  });

// ─── Tasks ───────────────────────────────────────────────────────────────

export const proofRequirementSchema = z.object({
  type: z.enum(PROOF_TYPE),
  fieldKey: z.string().trim().max(60).optional(),
  label: z.string().trim().min(1).max(120),
  required: z.boolean(),
  minCount: z.number().int().min(1).max(20).optional(),
});

/**
 * Budget bounds come from the business model. Below ₹300 fixed per-transaction
 * costs consume the contribution, so low-value tasks are not worth serving.
 */
export const MIN_TASK_BUDGET_PAISE = 30_000;
export const MAX_TASK_BUDGET_PAISE = 5_000_000;

/**
 * The task fields a client may supply.
 *
 * Note what is absent: commission, payout, status, and worker identity. Those
 * are computed or decided server-side and are never accepted from a client.
 * Zod strips unknown keys, so sending them has no effect.
 * See docs/16-security-requirements.md.
 *
 * Kept as a bare object so both the create and update schemas can derive from
 * it. Refinements are applied to the create schema below; chaining `.refine()`
 * produces a ZodEffects, which cannot be `.partial()`-ed.
 */
export const taskFieldsSchema = z.object({
  title: z.string().trim().min(8, 'Give the task a clear title').max(120),
  description: z
    .string()
    .trim()
    .min(30, 'Describe exactly what needs doing, and what must not be done')
    .max(5_000),
  categorySlug: z.enum(CATEGORY_SLUG),
  taskLocation: coordinatesSchema,
  taskAddress: z.string().trim().min(5).max(500),
  taskPlaceName: z.string().trim().max(200).optional(),
  taskPlaceId: z.string().trim().max(200).optional(),
  budgetPaise: paiseSchema.min(MIN_TASK_BUDGET_PAISE).max(MAX_TASK_BUDGET_PAISE),
  deadlineAt: z.coerce.date(),
  proofRequirements: z.array(proofRequirementSchema).min(1).max(20),
  attachmentKeys: z.array(z.string().max(500)).max(5).optional(),
});

export const createTaskSchema = taskFieldsSchema
  .refine((v) => v.deadlineAt.getTime() > Date.now() + 30 * 60 * 1000, {
    path: ['deadlineAt'],
    message: 'Deadline must be at least 30 minutes from now',
  })
  .refine((v) => v.deadlineAt.getTime() < Date.now() + 30 * 24 * 60 * 60 * 1000, {
    path: ['deadlineAt'],
    message: 'Deadline must be within 30 days',
  });

/** Drafts are edited field by field, so every field is optional here. */
export const updateTaskSchema = taskFieldsSchema.partial();

export const cancelTaskSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

export const nearbyTasksSchema = paginationSchema.extend({
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusMeters: z.coerce.number().int().min(500).max(50_000).optional(),
  categorySlug: z.enum(CATEGORY_SLUG).optional(),
});

export const declineTaskSchema = z.object({
  reason: z.enum(['TOO_FAR', 'BUDGET_TOO_LOW', 'UNCLEAR', 'UNAVAILABLE', 'SAFETY', 'OTHER']),
  note: z.string().trim().max(500).optional(),
});

// ─── Execution ───────────────────────────────────────────────────────────

/**
 * The client reports where it thinks it is. The server measures the distance
 * with PostGIS and decides what that means. There is deliberately no field
 * here for a client-supplied distance.
 */
export const arriveSchema = z.object({
  location: geoPointSchema,
});

export const presignUploadSchema = z.object({
  type: z.enum(['PHOTO', 'VIDEO']),
  contentType: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/webm',
  ]),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
});

export const recordProofSchema = z
  .object({
    type: z.enum(PROOF_TYPE),
    storageKey: z.string().max(500).optional(),
    location: geoPointSchema.optional(),
    capturedAt: z.coerce.date().optional(),
    fieldKey: z.string().trim().max(60).optional(),
    fieldValue: z.string().trim().max(500).optional(),
    noteBody: z.string().trim().max(5_000).optional(),
  })
  .refine(
    (v) =>
      v.type === 'NOTE'
        ? Boolean(v.noteBody)
        : v.type === 'STRUCTURED_FIELD'
          ? Boolean(v.fieldKey && v.fieldValue)
          : Boolean(v.storageKey),
    { message: 'Proof is missing its content' },
  );

export const submitTaskSchema = z.object({
  note: z.string().trim().max(2_000).optional(),
});

export const blockerSchema = z.object({
  reason: z.enum(['CLOSED', 'REFUSED_ACCESS', 'NOT_FOUND', 'UNSAFE', 'OTHER']),
  description: z.string().trim().min(10).max(2_000),
  storageKeys: z.array(z.string().max(500)).max(5).optional(),
});

// ─── Review ──────────────────────────────────────────────────────────────

export const rejectTaskSchema = z.object({
  reason: z.string().trim().min(10, 'Tell the worker what is missing').max(1_000),
});

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1_000).optional(),
});

// ─── Chat ────────────────────────────────────────────────────────────────

export const sendMessageSchema = z
  .object({
    body: z.string().trim().max(2_000).optional(),
    attachmentKey: z.string().max(500).optional(),
  })
  .refine((v) => Boolean(v.body) || Boolean(v.attachmentKey), {
    message: 'Write a message or attach an image',
  });

// ─── Notifications ───────────────────────────────────────────────────────

export const markNotificationsReadSchema = z.object({
  ids: z.array(uuidSchema).max(200).optional(),
});

const categoryPrefsSchema = z.object({
  push: z.boolean().optional(),
  email: z.boolean().optional(),
});

/** Every category is optional — a PATCH only touches the categories it names. Kept in sync with notifications/events.ts's NotificationCategory. */
export const notificationPreferencesSchema = z.object({
  TASK_ACTIVITY: categoryPrefsSchema.optional(),
  MESSAGES: categoryPrefsSchema.optional(),
  PAYMENTS: categoryPrefsSchema.optional(),
  MARKETING: categoryPrefsSchema.optional(),
});

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2_000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
  userAgent: z.string().max(500).optional(),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2_000),
});

// ─── Payments ────────────────────────────────────────────────────────────

/**
 * The amount is deliberately absent. It is computed server-side from the task
 * record. A client-supplied amount is never trusted.
 */
export const createPaymentOrderSchema = z.object({
  taskId: uuidSchema,
});

// ─── Disputes ────────────────────────────────────────────────────────────

export const createDisputeSchema = z.object({
  reason: z.enum([
    'WORK_NOT_DONE',
    'EVIDENCE_INSUFFICIENT',
    'INSTRUCTIONS_NOT_FOLLOWED',
    'EVIDENCE_FALSIFIED',
    'UNFAIR_REJECTION',
    'REQUESTER_UNRESPONSIVE',
    'OTHER',
  ]),
  description: z.string().trim().min(20, 'Explain what went wrong').max(5_000),
});

export const disputeStatementSchema = z.object({
  body: z.string().trim().min(10).max(5_000),
  attachmentKeys: z.array(z.string().max(500)).max(10).optional(),
});

export const resolveDisputeSchema = z
  .object({
    resolution: z.enum(['RELEASE_TO_WORKER', 'REFUND_TO_REQUESTER', 'SPLIT']),
    workerSharePercent: z.number().int().min(0).max(100).optional(),
    notes: z.string().trim().min(20, 'Record the reasoning').max(5_000),
  })
  .refine((v) => (v.resolution === 'SPLIT' ? v.workerSharePercent !== undefined : true), {
    path: ['workerSharePercent'],
    message: 'A split needs the percentage awarded to the worker',
  });

// ─── Safety ──────────────────────────────────────────────────────────────

export const reportUserSchema = z.object({
  reportedUserId: uuidSchema,
  taskId: uuidSchema.optional(),
  reason: z.enum(['FRAUD', 'HARASSMENT', 'SAFETY', 'OFF_PLATFORM', 'PROHIBITED_TASK', 'OTHER']),
  description: z.string().trim().min(10).max(2_000),
});

export const suspendUserSchema = z.object({
  reason: z.string().trim().min(10).max(1_000),
});

export const blockUserSchema = z.object({
  reason: z.string().trim().max(1_000).optional(),
});

// ─── Admin ───────────────────────────────────────────────────────────────

export const kycDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'RESUBMIT']),
    reason: z.string().trim().max(1_000).optional(),
  })
  .refine((v) => v.decision === 'APPROVE' || Boolean(v.reason), {
    path: ['reason'],
    message: 'A reason is required to reject or request resubmission',
  });

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and single hyphens only');

export const createCategorySchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(500),
    icon: z.string().trim().min(1).max(50),
    suggestedMinPaise: paiseSchema,
    suggestedMaxPaise: paiseSchema,
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.suggestedMaxPaise >= v.suggestedMinPaise, {
    path: ['suggestedMaxPaise'],
    message: 'Must be at least the minimum',
  });

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().min(1).max(500).optional(),
    icon: z.string().trim().min(1).max(50).optional(),
    suggestedMinPaise: paiseSchema.optional(),
    suggestedMaxPaise: paiseSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.suggestedMinPaise === undefined || v.suggestedMaxPaise === undefined || v.suggestedMaxPaise >= v.suggestedMinPaise, {
    path: ['suggestedMaxPaise'],
    message: 'Must be at least the minimum',
  });

export const createCitySchema = z.object({
  name: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().positive().max(100_000),
  isActive: z.boolean().default(true),
});

export const updateCitySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  state: z.string().trim().min(1).max(100).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMeters: z.number().int().positive().max(100_000).optional(),
  isActive: z.boolean().optional(),
});

// ─── Inferred types ──────────────────────────────────────────────────────

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type NearbyTasksInput = z.infer<typeof nearbyTasksSchema>;
export type ArriveInput = z.infer<typeof arriveSchema>;
export type RecordProofInput = z.infer<typeof recordProofSchema>;
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
export type WorkerProfileInput = z.infer<typeof workerProfileSchema>;
export type KycSubmissionInput = z.infer<typeof kycSubmissionSchema>;
export type KycPresignInput = z.infer<typeof kycPresignSchema>;
export type PayoutAccountInput = z.infer<typeof payoutAccountSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type CreatePaymentOrderInput = z.infer<typeof createPaymentOrderSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateCityInput = z.infer<typeof createCitySchema>;
export type UpdateCityInput = z.infer<typeof updateCitySchema>;
export type BlockerInput = z.infer<typeof blockerSchema>;
export type DeclineTaskInput = z.infer<typeof declineTaskSchema>;
export type SubmitTaskInput = z.infer<typeof submitTaskSchema>;
export type RejectTaskInput = z.infer<typeof rejectTaskSchema>;
export type CancelTaskInput = z.infer<typeof cancelTaskSchema>;
export type ReportUserInput = z.infer<typeof reportUserSchema>;
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;
export type BlockUserInput = z.infer<typeof blockUserSchema>;
export type DisputeStatementInput = z.infer<typeof disputeStatementSchema>;
export type KycDecisionInput = z.infer<typeof kycDecisionSchema>;
