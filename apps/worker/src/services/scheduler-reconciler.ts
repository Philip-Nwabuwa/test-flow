import { buildCronPattern, schedulerId, type RunJobPayload } from "@automation/shared";
import type { Queue } from "bullmq";

import { EdgeClient } from "../lib/edge-client.js";

export class SchedulerReconciler {
  constructor(
    private readonly edgeClient: EdgeClient,
    private readonly queue: Queue<RunJobPayload>
  ) {}

  async reconcile() {
    const schedules = await this.edgeClient.reconcileSchedules();

    for (const schedule of schedules) {
      const id = schedulerId(schedule.flowId, schedule.id);
      if (!schedule.enabled) {
        await this.queue.removeJobScheduler(id);
        continue;
      }

      await this.queue.upsertJobScheduler(
        id,
        {
          pattern: buildCronPattern(schedule),
          tz: schedule.timezone
        },
        {
          name: "scheduled-flow-run",
          data: {
            runId: "",
            flowId: schedule.flowId,
            testCaseId: schedule.testCaseId,
            projectId: schedule.project_id,
            triggerType: "scheduled",
            versionId: null,
            environment: schedule.environment,
            idempotencyKey: id
          },
          opts: {
            attempts: schedule.retryPolicy.attempts,
            backoff: {
              type: schedule.retryPolicy.backoffType,
              delay: schedule.retryPolicy.backoffMs
            }
          }
        }
      );
    }
  }
}
