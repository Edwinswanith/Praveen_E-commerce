import { z } from 'zod';

/**
 * All configuration is validated at boot. Missing optional integrations are
 * reported as "pending configuration" by /health and the admin AI status page
 * rather than crashing the app.
 */
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_VERSION: z.string().default('0.1.0'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** Run BullMQ workers inside the API process (dev). In prod run `pnpm worker` separately. */
  RUN_WORKERS_IN_API: bool.default(true),
  QUEUES_ENABLED: bool.default(true),

  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: bool.default(false),
  COOKIE_DOMAIN: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),

  STOREFRONT_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_URL: z.string().url().default('http://localhost:3001'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  /** Public base URL for media. Local driver serves /media from the API. */
  MEDIA_BASE_URL: z.string().default('/media'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  BARCODE_EAN_PREFIX: z.string().regex(/^\d{2,9}$/).default('20'),

  PAYMENT_PROVIDER: z.enum(['razorpay', 'mock', 'none']).default('none'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  COD_ENABLED: bool.default(true),
  PAYMENT_RESERVATION_MINUTES: z.coerce.number().default(30),

  SHIPPING_PROVIDER: z.enum(['manual', 'shiprocket']).default('manual'),
  SHIPROCKET_EMAIL: z.string().optional(),
  SHIPROCKET_PASSWORD: z.string().optional(),
  SHIPROCKET_PICKUP_LOCATION: z.string().default('Primary'),
  SHIPROCKET_PICKUP_PINCODE: z.string().optional(),

  EMBEDDING_PROVIDER: z.enum(['gemini', 'local']).default('local'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),
  EMBEDDING_DIMENSIONS: z.coerce.number().default(768),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('VYRA <no-reply@vyra.local>'),

  /** SMS for OTPs. console = log only (dev; refused in production). */
  SMS_PROVIDER: z.enum(['console', 'msg91']).default('console'),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  /** WhatsApp Business (Meta Cloud API) for order updates + cart reminders. Templates must be approved in Meta. */
  WHATSAPP_PROVIDER: z.enum(['none', 'meta']).default('none'),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_TEMPLATE_LANG: z.string().default('en'),
  OTP_PEPPER: z.string().min(16).optional(),

  COD_RTO_BLOCK_THRESHOLD: z.coerce.number().int().min(1).default(2),
  COD_CONFIRM_WINDOW_HOURS: z.coerce.number().int().min(1).default(24),
  /** Rupees. Percent 0 disables the prepaid incentive. */
  PREPAID_DISCOUNT_PERCENT: z.coerce.number().min(0).max(20).default(5),
  PREPAID_DISCOUNT_MAX: z.coerce.number().min(0).default(100),
  ABANDONED_CART_AFTER_HOURS: z.coerce.number().min(1).default(3),

  SELLER_NAME: z.string().default('VYRA Fashion (update SELLER_NAME)'),
  SELLER_GSTIN: z.string().optional(),
  SELLER_ADDRESS: z.string().default('Registered address pending configuration'),
  SELLER_STATE: z.string().default('Karnataka'),

  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.PAYMENT_PROVIDER === 'mock') throw new Error('PAYMENT_PROVIDER=mock is forbidden in production');
    if (parsed.data.EMBEDDING_PROVIDER === 'local') console.warn('[env] EMBEDDING_PROVIDER=local in production: search quality will be lexical only');
    if (!parsed.data.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (parsed.data.SMS_PROVIDER === 'console') console.warn('[env] SMS_PROVIDER=console in production: OTP login and COD confirmation cannot reach customers');
    if (!parsed.data.OTP_PEPPER) throw new Error('OTP_PEPPER is required in production');
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export const ENV = Symbol('ENV');
