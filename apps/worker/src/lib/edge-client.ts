import type { FlowSchedule, FlowStep, RunJobPayload } from "@automation/shared";

export interface ExecutionContext {
  runId: string;
  flowId: string;
  testCaseId: string;
  projectId: string;
  versionId: string | null;
  triggerType: string;
  environment: string | null;
  targetUrl: string;
  steps: FlowStep[];
  variables: Record<string, string>;
}

export interface PollQueueItem extends RunJobPayload {
  status: string;
  createdAt: string;
}

export class EdgeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async loadContext(payload: RunJobPayload): Promise<ExecutionContext> {
    return this.call<ExecutionContext>("worker-load-context", {
      runId: payload.runId,
      flowId: payload.flowId,
      testCaseId: payload.testCaseId,
      projectId: payload.projectId,
      environment: payload.environment,
      versionId: payload.versionId,
      triggerType: payload.triggerType
    });
  }

  async markRunStarted(runId: string): Promise<void> {
    await this.call("worker-update-run", { action: "start", runId });
  }

  async completeRun(data: {
    runId: string;
    flowId: string;
    testCaseId: string;
    status: string;
    errorMessage: string | null;
    stepResults: unknown;
    screenshotPath: string | null;
    hydratedSteps: unknown;
  }): Promise<void> {
    await this.call("worker-update-run", { action: "complete", ...data });
  }

  async failRun(data: {
    runId: string;
    flowId: string;
    errorMessage: string;
  }): Promise<void> {
    await this.call("worker-update-run", { action: "fail", ...data });
  }

  async createScheduledRun(payload: RunJobPayload): Promise<RunJobPayload | null> {
    return this.call<RunJobPayload | null>("worker-schedule", {
      action: "create-run",
      ...payload
    });
  }

  async reconcileSchedules(): Promise<(FlowSchedule & { project_id: string })[]> {
    return this.call<(FlowSchedule & { project_id: string })[]>("worker-schedule", {
      action: "reconcile"
    });
  }

  async pollQueue(limit = 10): Promise<PollQueueItem[]> {
    return this.call<PollQueueItem[]>("worker-poll-queue", { limit });
  }

  private async call<T>(functionName: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}/${functionName}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Edge function ${functionName} failed (${response.status}): ${text}`);
    }

    return response.json() as Promise<T>;
  }
}
