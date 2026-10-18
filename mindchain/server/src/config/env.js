import 'dotenv/config';
import { z } from 'zod';

// Validates the environment once at startup so misconfiguration fails fast
// instead of surfacing later as an insecure default.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('2h'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  // AES-256-GCM data key: exactly 32 bytes, hex-encoded (64 characters).
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  // Retired keys still needed to decrypt older records: "1:<hex>,2:<hex>".
  ENCRYPTION_PREVIOUS_KEYS: z
    .string()
    .regex(/^(\d+:[0-9a-fA-F]{64})(,\d+:[0-9a-fA-F]{64})*$/, 'ENCRYPTION_PREVIOUS_KEYS must be "version:hex" pairs')
    .optional()
    .or(z.literal('')),
});

function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid server configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && cfg.BCRYPT_ROUNDS < 12) {
    throw new Error('BCRYPT_ROUNDS must be at least 12 in production');
  }
  return Object.freeze({
    ...cfg,
    CLIENT_ORIGINS: cfg.CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
  });
}

export const config = loadConfig();
