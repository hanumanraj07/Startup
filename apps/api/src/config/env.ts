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
    // How many reverse proxies sit in front of the API and append to
    // X-Forwarded-For. 0 locally; 2 in production (Vercel's rewrite, Caddy).
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

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
    // Who sends workers their money. `mock` settles instantly (an account
    // number ending 0000 fails, to exercise the failure path); `none` keeps
    // payouts owed and visible until a payout partner is connected. Unset, it
    // is `none` in production and `mock` elsewhere. See payoutProvider().
    PAYOUT_PROVIDER: z.enum(['mock', 'none']).optional(),
    PAYOUT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    // Who checks identities (DigiLocker) and bank or UPI accounts. Cashfree
    // Secure ID was chosen after checking current offerings (ai/memory.md,
    // P4): Razorpay has no public end-user PAN/Aadhaar API, and its
    // fund-account validation needs RazorpayX and has no test mode. Unset, it
    // is `none` in production (manual document review only, accounts stay
    // unverified) and `mock` elsewhere. See verificationProvider().
    VERIFICATION_PROVIDER: z.enum(['mock', 'cashfree', 'none']).optional(),
    CASHFREE_VERIFICATION_CLIENT_ID: z.string().optional(),
    CASHFREE_VERIFICATION_CLIENT_SECRET: z.string().optional(),
    CASHFREE_VERIFICATION_BASE_URL: z.string().url().default('https://sandbox.cashfree.com/verification'),
    CASHFREE_VERIFICATION_API_VERSION: z.string().default('2024-12-01'),

    // Place search and reverse geocoding for the map picker. OpenStreetMap
    // only (founder decision, 2026-10-19): Photon, no key. A leftover
    // "google" value from older env files is read as osm rather than refusing
    // to boot; Google geocoding was never implemented.
    GEOCODING_PROVIDER: z.preprocess((v) => (v === 'google' ? 'osm' : v), z.enum(['osm', 'mock']).default('osm')),
    GEOCODING_OSM_URL: z.string().url().default('https://photon.komoot.io'),
    GOOGLE_MAPS_API_KEY: z.string().optional(),

    // Sign-in with Google. Only the client ID is needed server-side — ID
    // token verification checks the token's `aud` claim against it; no
    // secret changes hands in this flow (that's only needed for the
    // server-side OAuth code exchange, which this app doesn't use).
    GOOGLE_CLIENT_ID: z.string().optional(),

    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),

    EMAIL_PROVIDER: z.enum(['console', 'smtp', 'resend']).default('console'),
    EMAIL_FROM: z.string().default('OnSite <no-reply@example.com>'),
    SMTP_URL: z.string().optional(),

    SMS_PROVIDER: z.enum(['console', 'msg91', 'twilio']).default('console'),
    SMS_API_KEY: z.string().optional(),
    SMS_SENDER_ID: z.string().optional(),

    // Task moderation. Keyword rules always run; the OpenAI Moderation API
    // is added on top only when a key is configured. See
    // modules/moderation/moderation.service.ts.
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODERATION_MODEL: z.string().default('omni-moderation-latest'),
    MODERATION_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(86_400).default(300),

    // A rotated refresh token presented again within this many seconds is
    // treated as a concurrent duplicate (two tabs, a lost response), not as
    // theft. See auth.service.ts refresh().
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(300).default(30),

    REVIEW_WINDOW_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    DISPUTE_WINDOW_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    MIN_TASK_BUDGET_PAISE: z.coerce.number().int().positive().default(10_000),
    MAX_TASK_BUDGET_PAISE: z.coerce.number().int().positive().default(5_000_000),
    MAX_CONCURRENT_TASKS_PER_WORKER: z.coerce.number().int().min(1).max(20).default(3),
    // How long a worker has to answer an incoming task request; the next,
    // wider wave goes out when every request in a wave is answered or
    // expired (founder decision, 2026-10-19).
    OFFER_RESPONSE_SECONDS: z.coerce.number().int().min(15).max(900).default(90),
    // Live worker location: the latest point lives this long in Redis, and
    // updates closer together than the interval are dropped.
    LIVE_LOCATION_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(120),
    LIVE_LOCATION_MIN_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(2_000),
    // How far a pickup & delivery task may carry an item, pickup to drop-off.
    MAX_DELIVERY_DISTANCE_M: z.coerce.number().int().min(1_000).max(500_000).default(50_000),
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

  // A production deployment must never silently run on the mock payment driver.
  .refine((env) => env.NODE_ENV !== 'production' || env.PAYMENT_PROVIDER !== 'mock', {
    path: ['PAYMENT_PROVIDER'],
    message: 'The mock payment provider must not be used in production',
  })
  .refine(
    (env) =>
      env.VERIFICATION_PROVIDER !== 'cashfree' ||
      Boolean(env.CASHFREE_VERIFICATION_CLIENT_ID && env.CASHFREE_VERIFICATION_CLIENT_SECRET),
    {
      path: ['VERIFICATION_PROVIDER'],
      message: 'VERIFICATION_PROVIDER=cashfree requires CASHFREE_VERIFICATION_CLIENT_ID and CASHFREE_VERIFICATION_CLIENT_SECRET',
    },
  )
  .refine((env) => env.NODE_ENV !== 'production' || env.VERIFICATION_PROVIDER !== 'mock', {
    path: ['VERIFICATION_PROVIDER'],
    message: 'The mock verification provider must not be used in production',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.PAYOUT_PROVIDER !== 'mock', {
    path: ['PAYOUT_PROVIDER'],
    message: 'The mock payout provider must not be used in production',
  })
  .refine(
    (env) => env.MATCH_TIER_WAIT_MINUTES.length === env.MATCH_TIER_RADII_M.length - 1,
    {
      path: ['MATCH_TIER_WAIT_MINUTES'],
      message: 'MATCH_TIER_WAIT_MINUTES must have exactly one fewer entry than MATCH_TIER_RADII_M',
    },
  );

export type Env = z.infer<typeof envSchema>;

/** The identity and bank verification provider in effect: `none` by default in production. */
export function verificationProvider(env: Env = loadEnv()): 'mock' | 'cashfree' | 'none' {
  return env.VERIFICATION_PROVIDER ?? (env.NODE_ENV === 'production' ? 'none' : 'mock');
}

/** The payout provider in effect: `none` by default in production, so no deploy breaks for want of the setting. */
export function payoutProvider(env: Env = loadEnv()): 'mock' | 'none' {
  return env.PAYOUT_PROVIDER ?? (env.NODE_ENV === 'production' ? 'none' : 'mock');
}

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
