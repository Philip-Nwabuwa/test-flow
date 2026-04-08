import type { Queue } from "bullmq";
import type { RunJobPayload } from "@automation/shared";
import type { EdgeClient } from "../lib/edge-client.js";
import type { Logger } from "pino";

const DEFAULT_POLL_INTERVAL_MS = 5_000;

export class QueuePoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private readonly edgeClient: EdgeClient,
    private readonly queue: Queue<RunJobPayload>,
    private readonly logger: Logger,
    private readonly intervalMs = DEFAULT_POLL_INTERVAL_MS
  ) {}

  start(): void {
    if (this.timer) return;
    this.logger.info({ intervalMs: this.intervalMs }, "Queue poller started");
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info("Queue poller stopped");
    }
  }

  private async tick(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      const items = await this.edgeClient.pollQueue(10);
      if (items.length === 0) return;

      this.logger.info({ count: items.length }, "Polled pending runs from DB");

      for (const item of items) {
        const existing = await this.queue.getJob(item.runId);
        if (existing) {
          this.logger.debug({ runId: item.runId }, "Run already in BullMQ, skipping");
          continue;
        }

        const payload: RunJobPayload = {
          runId: item.runId,
          flowId: item.flowId,
          testCaseId: item.testCaseId,
          projectId: item.projectId,
          triggerType: item.triggerType,
          versionId: item.versionId,
          environment: item.environment,
          idempotencyKey: item.idempotencyKey,
          retryOfRunId: item.retryOfRunId ?? null
        };

        await this.queue.add("flow-run", payload, {
          jobId: item.runId,
          attempts: 2,
          backoff: { type: "fixed", delay: 30_000 },
          removeOnComplete: 1000,
          removeOnFail: 1000
        });

        this.logger.info({ runId: item.runId, flowId: item.flowId }, "Enqueued DB-polled run to BullMQ");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ error: message }, "Queue poll tick failed");
    } finally {
      this.polling = false;
    }
  }
}
