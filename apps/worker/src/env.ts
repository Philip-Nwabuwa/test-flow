import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  REDIS_URL: z.string().min(1),
  EDGE_FUNCTION_URL: z.string().url(),
  EDGE_FUNCTION_KEY: z.string().min(1),
  PLAYWRIGHT_IMAGE: z.string().min(1),
  PLAYWRIGHT_DOCKER_NETWORK: z.string().default("bridge"),
  PLAYWRIGHT_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  VARIABLE_ENCRYPTION_KEY: z.string().min(32)
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadEnv(): WorkerEnv {
  return envSchema.parse(process.env);
}
