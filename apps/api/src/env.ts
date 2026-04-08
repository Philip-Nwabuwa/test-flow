import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  REDIS_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_JWKS_URL: z.string().url(),
  SUPABASE_JWT_ISSUER: z.string().url(),
  SUPABASE_JWT_AUDIENCE: z.string().min(1).default("authenticated"),
  PLAYWRIGHT_IMAGE: z.string().min(1),
  PLAYWRIGHT_DOCKER_NETWORK: z.string().default("bridge"),
  PLAYWRIGHT_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  API_PORT: z.coerce.number().int().positive().default(4000),
  SSE_POLL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  VARIABLE_ENCRYPTION_KEY: z.string().min(32),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  CORS_ALLOWED_ORIGINS: z.string().optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(): AppEnv {
  return envSchema.parse(process.env);
}
