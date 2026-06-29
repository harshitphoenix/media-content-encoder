import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Server
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Storage
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_BUCKET_ORIGINALS: z.string().min(1),
  STORAGE_BUCKET_VARIANTS: z.string().min(1),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_FORCE_PATH_STYLE: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),

  // CDN
  CDN_BASE_URL: z.string().url(),
  CDN_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // File limits
  MAX_IMAGE_SIZE_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  MAX_VIDEO_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024 * 1024),
  MAX_IMAGE_WIDTH: z.coerce.number().int().positive().default(7680),
  MAX_IMAGE_HEIGHT: z.coerce.number().int().positive().default(4320),
  MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().positive().default(7200),

  // Job processing
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  JOB_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(5000),

  // Auth
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.string().default('7d'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
