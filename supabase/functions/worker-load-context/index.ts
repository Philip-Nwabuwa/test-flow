// Deploy this as a Supabase Edge Function via Lovable
// It loads the execution context for a flow run

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const expectedKey = Deno.env.get("EDGE_FUNCTION_KEY") ?? "";

Deno.serve(async (req: Request) => {
  // Auth check
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${expectedKey}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const { flowId, testCaseId, projectId, environment, versionId, triggerType, runId } = body;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  // Load flow + test_case + project
  const { data: context, error: ctxError } = await supabase
    .rpc("rpc_load_execution_context", {
      p_flow_id: flowId,
      p_test_case_id: testCaseId
    });

  if (ctxError || !context || context.length === 0) {
    return new Response(JSON.stringify({ error: "Flow context not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  const row = context[0];

  // Resolve steps
  let steps = [];
  const resolvedVersionId = versionId ?? row.published_version_id;

  if (resolvedVersionId) {
    const { data: version } = await supabase
      .from("flow_versions")
      .select("definition")
      .eq("id", resolvedVersionId)
      .single();

    if (version?.definition?.steps) {
      steps = version.definition.steps;
    }
  }

  if (steps.length === 0) {
    const { data: stepRows } = await supabase
      .from("test_steps")
      .select("id, test_case_id, sort_order, action_type, semantic_label, selector, value, expected_outcome, timeout_ms")
      .eq("test_case_id", testCaseId)
      .order("sort_order", { ascending: true });

    steps = (stepRows ?? []).map((s: Record<string, unknown>) => ({
      id: s.id,
      testCaseId: s.test_case_id,
      sortOrder: s.sort_order,
      actionType: s.action_type,
      semanticLabel: s.semantic_label,
      selector: s.selector,
      value: s.value,
      expectedOutcome: s.expected_outcome,
      timeoutMs: s.timeout_ms
    }));
  }

  // Resolve target URL
  let targetUrl = row.target_url;

  if (!targetUrl && environment) {
    const { data: envConfig } = await supabase
      .from("environment_configs")
      .select("base_url")
      .eq("project_id", projectId)
      .eq("environment", environment)
      .limit(1)
      .single();

    if (envConfig?.base_url) {
      targetUrl = envConfig.base_url;
    }
  }

  if (!targetUrl) {
    const { data: activeConfig } = await supabase
      .from("environment_configs")
      .select("base_url")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (activeConfig?.base_url) {
      targetUrl = activeConfig.base_url;
    }
  }

  if (!targetUrl) {
    targetUrl = row.project_base_url;
  }

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: "No target URL could be resolved" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Resolve variables
  const { data: varRows } = await supabase
    .rpc("rpc_resolve_variables", {
      p_project_id: projectId,
      p_flow_id: flowId
    });

  // NOTE: Variables are encrypted. The worker decrypts them locally using VARIABLE_ENCRYPTION_KEY.
  const variables: Record<string, string> = {};
  for (const v of varRows ?? []) {
    variables[v.name] = v.cipher_text;
  }

  return new Response(
    JSON.stringify({
      runId,
      flowId,
      testCaseId,
      projectId,
      versionId: resolvedVersionId,
      triggerType,
      environment,
      targetUrl,
      steps,
      variables
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
