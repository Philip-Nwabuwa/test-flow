import { Queue, Worker } from "bullmq";

import type { RunJobPayload } from "@automation/shared";

import { loadEnv } from "./env.js";
import { createLogger } from "./lib/logger.js";
import { createRedisConnection } from "./lib/redis.js";
import { DockerRuntime } from "./lib/docker-runtime.js";
import { EdgeClient } from "./lib/edge-client.js";
import { ExecutionService } from "./services/execution-service.js";
import { SchedulerReconciler } from "./services/scheduler-reconciler.js";

const RUN_QUEUE_NAME = "flow-runs";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const connection = createRedisConnection(env.REDIS_URL);
const queue = new Queue<RunJobPayload>(RUN_QUEUE_NAME, { connection });
const runtime = new DockerRuntime(
  env.PLAYWRIGHT_IMAGE,
  env.PLAYWRIGHT_DOCKER_NETWORK,
  env.PLAYWRIGHT_RUN_TIMEOUT_MS
);
const edgeClient = new EdgeClient(env.EDGE_FUNCTION_URL, env.EDGE_FUNCTION_KEY);
const executionService = new ExecutionService(edgeClient, runtime, env.VARIABLE_ENCRYPTION_KEY);

const worker = new Worker<RunJobPayload>(
  RUN_QUEUE_NAME,
  async (job) => {
    await executionService.process(job.data);
  },
  {
    connection,
    concurrency: env.WORKER_CONCURRENCY
  }
);

const reconciler = new SchedulerReconciler(edgeClient, queue);

await reconciler.reconcile();

worker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Run completed");
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error }, "Run failed");
});

logger.info({ concurrency: env.WORKER_CONCURRENCY }, "Worker started");
