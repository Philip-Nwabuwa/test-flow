import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  throwIfError,
  type AuthContext,
  type FlowDetail,
  type FlowDraftPayload,
  type FlowSummary,
  type FlowVersion
} from "@automation/shared";

import { HttpError } from "../lib/http.js";

export class FlowService {
  async list(supabase: SupabaseClient, auth: AuthContext, search?: string, status?: string): Promise<FlowSummary[]> {
    let query = supabase
      .from("test_flows")
      .select("id, project_id, name, status, run_count, target_url, flow_type, last_run_at, last_passed_at, last_failed_at")
      .in("project_id", auth.projectIds)
      .order("updated_at", { ascending: false });

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }
    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    throwIfError({ data, error });

    return (data ?? []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      status: row.status,
      runCount: row.run_count ?? 0,
      targetUrl: row.target_url,
      flowType: row.flow_type,
      lastRunAt: row.last_run_at,
      lastPassedAt: row.last_passed_at,
      lastFailedAt: row.last_failed_at
    }));
  }

  async getById(supabase: SupabaseClient, auth: AuthContext, flowId: string): Promise<FlowDetail> {
    const { data: flow, error: flowError } = await supabase
      .from("test_flows")
      .select(`
        id, project_id, name, status, run_count, target_url, flow_type,
        last_run_at, last_passed_at, last_failed_at, created_at, updated_at,
        test_cases!inner(
          id, intent, execution_mode, health_status, total_runs,
          draft_payload, published_version_id, target_url
        )
      `)
      .eq("id", flowId)
      .in("project_id", auth.projectIds)
      .single();

    if (flowError || !flow) {
      throw new HttpError(404, "Flow not found");
    }

    const testCase = Array.isArray(flow.test_cases) ? flow.test_cases[0] : flow.test_cases;

    const { data: steps } = await supabase
      .from("test_steps")
      .select("id, test_case_id, sort_order, action_type, semantic_label, selector, value, expected_outcome, timeout_ms")
      .eq("test_case_id", testCase.id)
      .order("sort_order", { ascending: true });

    return {
      id: flow.id,
      projectId: flow.project_id,
      name: flow.name,
      status: flow.status,
      runCount: flow.run_count ?? 0,
      targetUrl: flow.target_url,
      flowType: flow.flow_type,
      lastRunAt: flow.last_run_at,
      lastPassedAt: flow.last_passed_at,
      lastFailedAt: flow.last_failed_at,
      testCaseId: testCase.id,
      intent: testCase.intent,
      executionMode: testCase.execution_mode,
      healthStatus: testCase.health_status ?? "untested",
      totalRuns: testCase.total_runs ?? 0,
      draftPayload: testCase.draft_payload,
      publishedVersionId: testCase.published_version_id,
      createdAt: flow.created_at,
      updatedAt: flow.updated_at,
      steps: (steps ?? []).map(mapStep)
    };
  }

  async create(
    supabase: SupabaseClient,
    auth: AuthContext,
    input: {
      projectId: string;
      name: string;
      targetUrl?: string;
      flowType?: string;
      draft: FlowDraftPayload;
    }
  ): Promise<FlowDetail> {
    if (!auth.projectIds.includes(input.projectId)) {
      throw new HttpError(403, "Project access denied");
    }

    const flowId = randomUUID();
    const testCaseId = randomUUID();

    const result = await supabase.rpc("rpc_create_flow", {
      p_flow_id: flowId,
      p_project_id: input.projectId,
      p_name: input.name,
      p_target_url: input.targetUrl ?? null,
      p_flow_type: input.flowType ?? "user",
      p_test_case_id: testCaseId,
      p_intent: input.draft.intent,
      p_draft_payload: input.draft,
      p_steps: input.draft.steps
    });

    throwIfError(result);

    return this.getById(supabase, auth, flowId);
  }

  async update(
    supabase: SupabaseClient,
    auth: AuthContext,
    flowId: string,
    input: {
      name?: string;
      status?: string;
      targetUrl?: string | null;
      flowType?: string | null;
      intent?: string | null;
      healthStatus?: string;
    }
  ): Promise<FlowDetail> {
    const existing = await this.getById(supabase, auth, flowId);

    const flowUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) flowUpdates.name = input.name;
    if (input.status !== undefined) flowUpdates.status = input.status;
    if (input.targetUrl !== undefined) flowUpdates.target_url = input.targetUrl;
    if (input.flowType !== undefined) flowUpdates.flow_type = input.flowType;

    await supabase.from("test_flows").update(flowUpdates).eq("id", flowId);

    const caseUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) caseUpdates.title = input.name;
    if (input.intent !== undefined) caseUpdates.intent = input.intent;
    if (input.healthStatus !== undefined) caseUpdates.health_status = input.healthStatus;
    if (input.targetUrl !== undefined) caseUpdates.target_url = input.targetUrl;

    await supabase.from("test_cases").update(caseUpdates).eq("id", existing.testCaseId);

    return this.getById(supabase, auth, flowId);
  }

  async saveDraft(
    supabase: SupabaseClient,
    auth: AuthContext,
    flowId: string,
    draft: FlowDraftPayload
  ): Promise<FlowDetail> {
    const existing = await this.getById(supabase, auth, flowId);

    await supabase
      .from("test_cases")
      .update({
        intent: draft.intent,
        target_url: draft.targetUrl ?? existing.targetUrl,
        draft_payload: draft,
        updated_at: new Date().toISOString()
      })
      .eq("id", existing.testCaseId);

    // Replace steps: delete then insert
    await supabase.from("test_steps").delete().eq("test_case_id", existing.testCaseId);

    if (draft.steps.length > 0) {
      const stepRows = draft.steps.map((step) => ({
        id: randomUUID(),
        test_case_id: existing.testCaseId,
        sort_order: step.sortOrder,
        action_type: step.actionType,
        semantic_label: step.semanticLabel,
        selector: step.selector ?? null,
        value: step.value ?? null,
        expected_outcome: step.expectedOutcome ?? null,
        timeout_ms: step.timeoutMs ?? null
      }));

      await supabase.from("test_steps").insert(stepRows);
    }

    return this.getById(supabase, auth, flowId);
  }

  async publish(supabase: SupabaseClient, auth: AuthContext, flowId: string): Promise<FlowVersion> {
    const flow = await this.getById(supabase, auth, flowId);

    const { data: maxVersion } = await supabase
      .from("flow_versions")
      .select("version_number")
      .eq("flow_id", flowId)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();

    const versionId = randomUUID();
    const versionNumber = (maxVersion?.version_number ?? 0) + 1;
    const definition: FlowDraftPayload = flow.draftPayload ?? {
      intent: flow.intent ?? "",
      targetUrl: flow.targetUrl,
      executionMode: flow.executionMode,
      healthStatus: flow.healthStatus,
      steps: flow.steps
    };

    const result = await supabase.rpc("rpc_publish_flow", {
      p_flow_id: flowId,
      p_test_case_id: flow.testCaseId,
      p_version_id: versionId,
      p_version_number: versionNumber,
      p_definition: definition,
      p_created_by: auth.userId
    });

    throwIfError(result);

    return {
      id: versionId,
      flowId,
      testCaseId: flow.testCaseId,
      versionNumber,
      definition,
      createdBy: auth.userId,
      createdAt: new Date().toISOString()
    };
  }

  async duplicate(supabase: SupabaseClient, auth: AuthContext, flowId: string): Promise<FlowDetail> {
    const source = await this.getById(supabase, auth, flowId);
    return this.create(supabase, auth, {
      projectId: source.projectId,
      name: `${source.name} (copy)`,
      targetUrl: source.targetUrl ?? undefined,
      flowType: source.flowType ?? undefined,
      draft: source.draftPayload ?? {
        intent: source.intent ?? "",
        targetUrl: source.targetUrl,
        executionMode: source.executionMode,
        healthStatus: source.healthStatus,
        steps: source.steps
      }
    });
  }

  async listVersions(supabase: SupabaseClient, auth: AuthContext, flowId: string): Promise<FlowVersion[]> {
    await this.getById(supabase, auth, flowId);

    const { data, error } = await supabase
      .from("flow_versions")
      .select("id, flow_id, test_case_id, version_number, definition, created_by, created_at")
      .eq("flow_id", flowId)
      .order("version_number", { ascending: false });

    throwIfError({ data, error });

    return (data ?? []).map((row) => ({
      id: row.id,
      flowId: row.flow_id,
      testCaseId: row.test_case_id,
      versionNumber: row.version_number,
      definition: row.definition,
      createdBy: row.created_by,
      createdAt: row.created_at
    }));
  }
}

function mapStep(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    testCaseId: String(row.test_case_id),
    sortOrder: Number(row.sort_order),
    actionType: String(row.action_type) as FlowDetail["steps"][number]["actionType"],
    semanticLabel: String(row.semantic_label),
    selector: typeof row.selector === "string" ? row.selector : null,
    value: typeof row.value === "string" ? row.value : null,
    expectedOutcome: typeof row.expected_outcome === "string" ? row.expected_outcome : null,
    timeoutMs: typeof row.timeout_ms === "number" ? row.timeout_ms : null
  };
}
