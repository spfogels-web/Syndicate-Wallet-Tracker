import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PUBLIC_URL: z.string().url().optional(),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_DEFAULT_CHAT_ID: z.string().optional(),
  TELEGRAM_BOOTSTRAP_ADMINS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    ),

  HELIUS_API_KEY: z.string().min(1, 'HELIUS_API_KEY is required'),
  HELIUS_WEBHOOK_AUTH_HEADER: z.string().optional(),

  ALCHEMY_API_KEY: z.string().min(1, 'ALCHEMY_API_KEY is required'),
  ALCHEMY_WEBHOOK_SIGNING_KEY: z.string().optional(),

  ETHERSCAN_API_KEY: z.string().min(1, 'ETHERSCAN_API_KEY is required'),

  // Web dashboard auth. Optional — if unset, /dashboard returns 404 (feature disabled).
  DASHBOARD_PASSWORD: z.string().min(8).optional(),
  DASHBOARD_SESSION_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  // Treat empty-string env vars as missing so `.default(...)` and `.optional()` apply.
  // Railway's UI happily saves blank values, which would otherwise crash zod validation
  // for enum/url fields that have defaults.
  const cleaned: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    cleaned[k] = v === '' ? undefined : v;
  }
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    // Print all field issues then exit — never start the bot with broken config.
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment variables:');
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
