import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuthContext,
  DashboardInsight,
  DashboardProblem,
  DashboardSummary,
  RunRecord
} from "@automation/shared";

import { throwIfError } from "@automation/shared";

export class DashboardService {
  async summary(supabase: SupabaseClient, auth: AuthContext): Promise<DashboardSummary> {
    const result = await supabase.rpc("rpc_dashboard_summary", {
      p_project_ids: auth.projectIds
    });

    const rows = throwIfError(result);
    const row = Array.isArray(rows) ? rows[0] : rows;

    return row ?? {
      all: 0,
      failed: 0,
      passed: 0,
      notRun: 0,
      totalRuns: 0,
      recentRuns: 0
    };
  }

  async problems(supabase: SupabaseClient, auth: AuthContext): Promise<DashboardProblem[]> {
    const result = await supabase.rpc("rpc_dashboard_problems", {
      p_project_ids: auth.projectIds
    });

    return (throwIfError(result) as DashboardProblem[]) ?? [];
  }

  async insights(supabase: SupabaseClient, auth: AuthContext): Promise<DashboardInsight[]> {
    const { data: neverRun } = await supabase
      .from("test_flows")
      .select("id, name, test_cases!inner(id)")
      .in("project_id", auth.projectIds)
      .or("run_count.is.null,run_count.eq.0")
      .order("updated_at", { ascending: false })
      .limit(5);

    const { data: stable } = await supabase
      .from("test_flows")
      .select("id, name, test_cases!inner(id)")
      .in("project_id", auth.projectIds)
      .eq("status", "passed")
      .order("last_passed_at", { ascending: false, nullsFirst: false })
      .limit(5);

    const insights: DashboardInsight[] = (neverRun ?? []).map((row) => {
      const tc = Array.isArray(row.test_cases) ? row.test_cases[0] : row.test_cases;
      return {
        type: "never_run" as const,
        flowId: row.id,
        testCaseId: tc?.id,
        title: `${row.name} has never been tested`,
        description: "Run this flow to generate the first execution baseline."
      };
    });

    insights.push(
      ...(stable ?? []).map((row) => {
        const tc = Array.isArray(row.test_cases) ? row.test_cases[0] : row.test_cases;
        return {
          type: "stable" as const,
          flowId: row.id,
          testCaseId: tc?.id,
          title: `${row.name} is stable`,
          description: "All recent runs passed."
        };
      })
    );

    insights.push({
      type: "warning",
      title: "Authentication Required",
      description: "Missing login system flows can block downstream scenarios."
    });

    return insights;
  }

  async history(
    supabase: SupabaseClient,
    auth: AuthContext,
    filters: { status?: string; trigger?: string; flowId?: string; limit?: number }
  ): Promise<RunRecord[]> {
    let query = supabase
      .from("test_runs_v2")
      .select("*")
      .in("project_id", auth.projectIds)
      .order("created_at", { ascending: false })
      .limit(filters.limit ?? 50);

    if (filters.status) {
      query = query.eq("status", filters.status);
    }
    if (filters.trigger) {
      query = query.eq("trigger_type", filters.trigger);
    }
    if (filters.flowId) {
      query = query.eq("flow_id", filters.flowId);
    }

    const { data, error } = await query;
    throwIfError({ data, error });

    return (data ?? []).map(mapRun);
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
