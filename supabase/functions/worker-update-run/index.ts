// Deploy this as a Supabase Edge Function via Lovable
// Handles run lifecycle: start, complete, fail

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

  if (action === "start") {
    const { error } = await supabase.rpc("rpc_mark_run_started", {
      p_run_id: body.runId
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (action === "complete") {
    const { error } = await supabase.rpc("rpc_complete_run", {
      p_run_id: body.runId,
      p_flow_id: body.flowId,
      p_test_case_id: body.testCaseId,
      p_status: body.status,
      p_error_message: body.errorMessage,
      p_step_results: body.stepResults,
      p_screenshot_path: body.screenshotPath,
      p_hydrated_steps: body.hydratedSteps
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (action === "fail") {
    const { error } = await supabase.rpc("rpc_fail_run", {
      p_run_id: body.runId,
      p_flow_id: body.flowId,
      p_error_message: body.errorMessage
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
    status: 400,
    headers: { "Content-Type": "application/json" }
  });
});
