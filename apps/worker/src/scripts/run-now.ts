// Enqueue a one-off manual run on the `flow-runs` bullmq queue.
// The worker (bun run --cwd apps/worker dev) will pick it up, route the
// empty runId through worker-schedule create-run to mint a real runId,
// then execute the flow via Playwright and post results back.
//
// Usage:
//   export REDIS_URL="redis://localhost:6379"
//   bun apps/worker/src/scripts/run-now.ts <flowId> <testCaseId> <projectId> [environment]

import { Queue } from "bullmq";

import type { RunJobPayload } from "@automation/shared";

import { createRedisConnection } from "../lib/redis.js";

const RUN_QUEUE_NAME = "flow-runs";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error("Missing REDIS_URL in environment.");
  process.exit(2);
}

const [flowId, testCaseId, projectId, environment] = process.argv.slice(2);

if (!flowId || !testCaseId || !projectId) {
  console.error(
    "Usage: bun apps/worker/src/scripts/run-now.ts <flowId> <testCaseId> <projectId> [environment]"
  );
  process.exit(2);
}

const idempotencyKey = `manual-${Date.now()}`;
const payload: RunJobPayload = {
  runId: "",
  flowId,
  testCaseId,
  projectId,
  triggerType: "manual",
  versionId: null,
  environment: environment ?? null,
  idempotencyKey
};

const connection = createRedisConnection(redisUrl);
const queue = new Queue<RunJobPayload>(RUN_QUEUE_NAME, { connection });

try {
  const job = await queue.add("flow-run", payload, {
    jobId: idempotencyKey,
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 100
  });

  console.log(`Enqueued job ${job.id} on queue "${RUN_QUEUE_NAME}"`);
  console.log(`  flowId=${flowId}`);
  console.log(`  testCaseId=${testCaseId}`);
  console.log(`  projectId=${projectId}`);
  console.log(`  environment=${environment ?? "(none)"}`);
  console.log(`  idempotencyKey=${idempotencyKey}`);
  console.log("Watch the worker terminal for execution logs.");
} finally {
  await queue.close();
  await connection.quit();
}
