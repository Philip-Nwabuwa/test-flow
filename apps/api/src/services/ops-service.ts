import type { Queue } from "bullmq";

import type { RunJobPayload } from "@automation/shared";

import { getFailedJobs, getQueueSnapshot } from "../lib/queue.js";

export class OpsService {
  constructor(private readonly queue: Queue<RunJobPayload>) {}

  async queueStats() {
    return getQueueSnapshot(this.queue);
  }

  async failedJobs(limit?: number) {
    return getFailedJobs(this.queue, limit);
  }
}
