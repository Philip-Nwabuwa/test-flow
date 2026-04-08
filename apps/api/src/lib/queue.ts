import { Queue } from "bullmq";

import type { RunJobPayload } from "@automation/shared";

import { createRedisConnection } from "./redis.js";

export const RUN_QUEUE_NAME = "flow-runs";

export function createRunQueue(redisUrl: string) {
  const connection = createRedisConnection(redisUrl);
  return new Queue<RunJobPayload>(RUN_QUEUE_NAME, { connection });
}

export interface QueueSnapshot {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: number;
}

export interface FailedJobSummary {
  id: string | undefined;
  name: string;
  failedReason: string | undefined;
  attemptsMade: number;
  timestamp: number;
  data: RunJobPayload;
}

export async function getQueueSnapshot(queue: Queue<RunJobPayload>): Promise<QueueSnapshot> {
  const counts = await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed", "paused");

  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    paused: counts.paused ?? 0
  };
}

export async function getFailedJobs(queue: Queue<RunJobPayload>, limit = 25): Promise<FailedJobSummary[]> {
  const jobs = await queue.getJobs(["failed"], 0, Math.max(limit - 1, 0), true);

  return jobs.map((job) => ({
    id: job.id?.toString(),
    name: job.name,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
    data: job.data
  }));
}
