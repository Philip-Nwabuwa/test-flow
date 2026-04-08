import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Queue } from "bullmq";

import { throwIfError, type AuthContext, type RunJobPayload, type RunRecord, type TriggerType } from "@automation/shared";

import { HttpError } from "../lib/http.js";

export class RunService {
  constructor(private readonly queue: Queue<RunJobPayload>) {}

  async createManualRun(
    supabase: SupabaseClient,
    auth: AuthContext,
    flowId: string,
    input: {
      versionId?: string | null;
      environment?: string | null;
      idempotencyKey?: string;
      reason?: string;
      triggerType?: TriggerType;
      retryOfRunId?: string | null;
    }
  ): Promise<RunRecord> {
    const { data: flow, error: flowError } = await supabase
      .from("test_flows")
      .select("id, project_id, test_cases!inner(id, published_version_id)")
      .eq("id", flowId)
      .in("project_id", auth.projectIds)
      .single();

    if (flowError || !flow) {
      throw new HttpError(404, "Flow not found");
    }

    const testCase = Array.isArray(flow.test_cases) ? flow.test_cases[0] : flow.test_cases;
    const runId = randomUUID();
    const triggerType = input.triggerType ?? "manual";
    const versionId = input.versionId ?? testCase.published_version_id;
    const idempotencyKey = input.idempotencyKey ?? `${flowId}:${runId}`;

    // Insert run record
    const { error: runError } = await supabase
      .from("test_runs_v2")
      .insert({
        id: runId,
        flow_id: flow.id,
        test_case_id: testCase.id,
        project_id: flow.project_id,
        status: "queued",
        trigger_type: triggerType,
        environment: input.environment ?? null,
        version_id: versionId,
        retry_of_run_id: input.retryOfRunId ?? null,
        step_results: [],
        metadata: { reason: input.reason ?? null }
      });

    if (runError) {
      throw new Error(`Failed to create run: ${runError.message}`);
    }

    // Insert execution queue entry
    const { error: queueError } = await supabase
      .from("execution_queue")
      .insert({
        id: randomUUID(),
        run_id: runId,
        flow_id: flow.id,
        test_case_id: testCase.id,
        project_id: flow.project_id,
        status: "pending",
        trigger_type: triggerType,
        environment: input.environment ?? null,
        retry_count: 0,
        max_retries: 2,
        payload: { idempotencyKey }
      });

    if (queueError) {
      throw new Error(`Failed to enqueue run: ${queueError.message}`);
    }

    const payload: RunJobPayload = {
      runId,
      flowId: flow.id,
      testCaseId: testCase.id,
      projectId: flow.project_id,
      triggerType,
      versionId,
      environment: input.environment ?? null,
      idempotencyKey,
      retryOfRunId: input.retryOfRunId ?? null
    };

    await this.queue.add("flow-run", payload, {
      jobId: runId,
      attempts: 2,
      backoff: { type: "fixed", delay: 30000 },
      removeOnComplete: 1000,
      removeOnFail: 1000
    });

    return this.getRun(supabase, auth, runId);
  }

  async listForFlow(supabase: SupabaseClient, auth: AuthContext, flowId: string): Promise<RunRecord[]> {
    const { data, error } = await supabase
      .from("test_runs_v2")
      .select("*")
      .eq("flow_id", flowId)
      .in("project_id", auth.projectIds)
      .order("created_at", { ascending: false });

    throwIfError({ data, error });

    return (data ?? []).map(mapRun);
  }

  async getRun(supabase: SupabaseClient, auth: AuthContext, runId: string): Promise<RunRecord> {
    const { data, error } = await supabase
      .from("test_runs_v2")
      .select("*")
      .eq("id", runId)
      .in("project_id", auth.projectIds)
      .single();

    if (error || !data) {
      throw new HttpError(404, "Run not found");
    }

    return mapRun(data);
  }

  async getArtifacts(supabase: SupabaseClient, auth: AuthContext, runId: string) {
    await this.getRun(supabase, auth, runId);

    const { data, error } = await supabase
      .from("run_artifacts")
      .select("id, run_id, artifact_type, storage_path, content_type, created_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });

    throwIfError({ data, error });

    return (data ?? []).map((row) => ({
      id: row.id,
      runId: row.run_id,
      artifactType: row.artifact_type,
      storagePath: row.storage_path,
      contentType: row.content_type,
      createdAt: row.created_at
    }));
  }

  async retry(supabase: SupabaseClient, auth: AuthContext, runId: string): Promise<RunRecord> {
    const existing = await this.getRun(supabase, auth, runId);
    return this.createManualRun(supabase, auth, existing.flowId, {
      environment: existing.environment,
      versionId: existing.versionId,
      triggerType: "retry",
      retryOfRunId: runId,
      reason: "Retry requested from dashboard"
    });
  }

  async cancel(supabase: SupabaseClient, auth: AuthContext, runId: string): Promise<RunRecord> {
    await this.getRun(supabase, auth, runId);

    await supabase
      .from("test_runs_v2")
      .update({ status: "canceled", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", runId);

    await supabase
      .from("execution_queue")
      .update({ status: "canceled", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("run_id", runId)
      .in("status", ["pending", "running"]);

    const job = await this.queue.getJob(runId);
    if (job) {
      await job.remove();
    }

    return this.getRun(supabase, auth, runId);
  }
}

function mapRun(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    flowId: String(row.flow_id),
    testCaseId: String(row.test_case_id),
    projectId: String(row.project_id),
    status: row.status as RunRecord["status"],
    triggerType: row.trigger_type as RunRecord["triggerType"],
    environment: row.environment as string | null,
    versionId: row.version_id as string | null,
    retryOfRunId: row.retry_of_run_id as string | null,
    errorMessage: row.error_message as string | null,
    startedAt: row.started_at as string | null,
    finishedAt: row.finished_at as string | null,
    durationMs: row.duration_ms as number | null,
    stepResults: (row.step_results as RunRecord["stepResults"]) ?? [],
    screenshotPath: row.screenshot_path as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
