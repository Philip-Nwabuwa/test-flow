// Deploy this as a Supabase Edge Function via Lovable
// Handles scheduled run creation and schedule reconciliation

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const expectedKey = Deno.env.get("EDGE_FUNCTION_KEY") ?? "";

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${expectedKey}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const { action } = body;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  if (action === "create-run") {
    const { flowId, testCaseId, projectId, environment } = body;

    // Check for overlapping runs
    const { data: hasOverlap } = await supabase
      .rpc("rpc_check_overlapping_runs", {
        p_flow_id: flowId,
        p_test_case_id: testCaseId
      });

    if (hasOverlap) {
      return new Response("null", {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Get published version
    const { data: tc } = await supabase
      .from("test_cases")
      .select("published_version_id")
      .eq("id", testCaseId)
      .single();

    const runId = crypto.randomUUID();
    const versionId = tc?.published_version_id ?? null;

    const { error } = await supabase.rpc("rpc_create_scheduled_run", {
      p_run_id: runId,
      p_flow_id: flowId,
      p_test_case_id: testCaseId,
      p_project_id: projectId,
      p_environment: environment ?? null,
      p_version_id: versionId,
      p_payload: body
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(
      JSON.stringify({
        ...body,
        runId,
        versionId
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  if (action === "reconcile") {
    const { data, error } = await supabase.rpc("rpc_get_schedules_with_project");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify(data ?? []), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
    status: 400,
    headers: { "Content-Type": "application/json" }
  });
});
