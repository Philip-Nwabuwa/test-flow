import { AuthoringSessionStore } from "@automation/shared";

import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./lib/logger.js";
import { createRedisConnection } from "./lib/redis.js";
import { SessionManager } from "./services/session-manager.js";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const redis = createRedisConnection(env.REDIS_URL);
const store = new AuthoringSessionStore(redis);
const manager = new SessionManager(
  store,
  env.AUTHORING_SESSION_TTL_MS,
  env.RECORDER_VIEWPORT_WIDTH,
  env.RECORDER_VIEWPORT_HEIGHT,
  logger
);
const { server } = createApp(env, manager);

server.listen(env.RECORDER_PORT, () => {
  logger.info({ port: env.RECORDER_PORT }, "Recorder listening");
});
