import { z } from 'zod';

/**
 * Environment configuration, parsed and validated once at startup.
 *
 * The process refuses to boot on missing or malformed configuration rather
 * than failing mysteriously at 2am. See docs/16-security-requirements.md.
 */

const commaSeparatedInts = (label: string) =>
  z
    .string()
    .transform((s) => s.split(',').map((v) => Number.parseInt(v.trim(), 10)))
    .refine((arr) => arr.length > 0 && arr.every((n) => Number.isInteger(n) && n > 0), {
      message: `${label} must be a comma-separated list of positive integers`,
    });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    ROLE: z.enum(['api', 'worker']).default('api'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    API_URL: z.string().url().default('http://localhost:4000'),
    WEB_URL: z.string().url().default('http://localhost:3000'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(20),

    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

    // Base64-encoded 32-byte key for AES-256-GCM. Generate with:
    //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    // Required to accept KYC submissions; not required to boot otherwise, so
    // the rest of the app runs before this is provisioned.
    ENCRYPTION_KEY: z
      .string()
      .optional()
      .refine((v) => !v || Buffer.from(v, 'base64').length === 32, {
        message: 'ENCRYPTION_KEY must be base64 for exactly 32 bytes',
      }),

    STORAGE_ENDPOINT: z.string().url(),
    STORAGE_REGION: z.string().default('ap-south-1'),
    STORAGE_BUCKET: z.string().min(1),
    STORAGE_ACCESS_KEY: z.string().min(1),
    STORAGE_SECRET_KEY: z.string().min(1),
    STORAGE_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    STORAGE_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
    UPLOAD_MAX_PHOTO_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
    UPLOAD_MAX_VIDEO_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),

    PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    PLATFORM_COMMISSION_BPS: z.coerce.number().int().min(0).max(10_000).default(1_500),

    GST_ON_COMMISSION_BPS: z.coerce.number().int().min(0).max(10_000).default(0),
    TCS_BPS: z.coerce.number().int().min(0).max(10_000).default(0),
    TDS_194O_BPS: z.coerce.number().int().min(0).max(10_000).default(0),

    GEOCODING_PROVIDER: z.enum(['google', 'mock']).default('mock'),
    GOOGLE_MAPS_API_KEY: z.string().optional(),

    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),

    EMAIL_PROVIDER: z.enum(['console', 'smtp', 'resend']).default('console'),
    EMAIL_FROM: z.string().default('OnSite <no-reply@example.com>'),
    SMTP_URL: z.string().optional(),

    SMS_PROVIDER: z.enum(['console', 'msg91', 'twilio']).default('console'),
    SMS_API_KEY: z.string().optional(),
    SMS_SENDER_ID: z.string().optional(),

    REVIEW_WINDOW_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    DISPUTE_WINDOW_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    MIN_TASK_BUDGET_PAISE: z.coerce.number().int().positive().default(30_000),
    MAX_TASK_BUDGET_PAISE: z.coerce.number().int().positive().default(5_000_000),
    MAX_CONCURRENT_TASKS_PER_WORKER: z.coerce.number().int().min(1).max(20).default(3),
    DEFAULT_WORKER_RADIUS_M: z.coerce.number().int().min(500).max(50_000).default(10_000),
    MATCH_TIER_RADII_M: commaSeparatedInts('MATCH_TIER_RADII_M').default('3000,7000,15000,30000'),
    MATCH_TIER_WAIT_MINUTES: commaSeparatedInts('MATCH_TIER_WAIT_MINUTES').default('10,15,20'),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    SENTRY_DSN: z.string().optional(),
  })
  // Fail at startup rather than at the first payment attempt.
  .refine(
    (env) =>
      env.PAYMENT_PROVIDER !== 'razorpay' ||
      Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET),
    {
      path: ['PAYMENT_PROVIDER'],
      message:
        'PAYMENT_PROVIDER=razorpay requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET',
    },
  )
  .refine((env) => env.GEOCODING_PROVIDER !== 'google' || Boolean(env.GOOGLE_MAPS_API_KEY), {
    path: ['GEOCODING_PROVIDER'],
    message: 'GEOCODING_PROVIDER=google requires GOOGLE_MAPS_API_KEY',
  })
  // A production deployment must never silently run on the mock payment driver.
  .refine((env) => env.NODE_ENV !== 'production' || env.PAYMENT_PROVIDER !== 'mock', {
    path: ['PAYMENT_PROVIDER'],
    message: 'The mock payment provider must not be used in production',
  })
  .refine(
    (env) => env.MATCH_TIER_WAIT_MINUTES.length === env.MATCH_TIER_RADII_M.length - 1,
    {
      path: ['MATCH_TIER_WAIT_MINUTES'],
      message: 'MATCH_TIER_WAIT_MINUTES must have exactly one fewer entry than MATCH_TIER_RADII_M',
    },
  );

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Deliberately not the logger: this happens before the logger exists.
    console.error(`\nInvalid environment configuration:\n\n${issues}\n`);
    throw new Error('Invalid environment configuration');
  }

  cached = result.data;
  return cached;
}

/** Test-only. Clears the memoised configuration. */
export function resetEnvCache(): void {
  cached = null;
}
