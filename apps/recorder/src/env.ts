import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  RECORDER_PORT: z.coerce.number().int().positive().default(4100),
  REDIS_URL: z.string().min(1),
  RECORDER_INTERNAL_KEY: z.string().min(1),
  AUTHORING_TOKEN_SECRET: z.string().min(32),
  AUTHORING_SESSION_TTL_MS: z.coerce.number().int().positive().default(1800000),
  AUTHORING_ALLOWED_FRAME_ANCESTORS: z.string().default("'self'"),
  NOVNC_STATIC_DIR: z.string().default("/usr/share/novnc"),
  RECORDER_VIEWPORT_WIDTH: z.coerce.number().int().positive().default(1280),
  RECORDER_VIEWPORT_HEIGHT: z.coerce.number().int().positive().default(800)
});

export type RecorderEnv = z.infer<typeof envSchema>;

export function loadEnv(): RecorderEnv {
  return envSchema.parse(process.env);
}
