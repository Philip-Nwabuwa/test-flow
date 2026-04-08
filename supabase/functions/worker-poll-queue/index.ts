// Deploy this as a Supabase Edge Function via Lovable
// Returns unclaimed execution_queue items so the EC2 worker can pick them up

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
  const limit = body.limit ?? 10;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  // Fetch execution_queue items that are pending or running but not yet
  // completed/failed/canceled — these are the jobs that need a worker.
  // Only grab items created in the last hour to avoid picking up stale rows.
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: items, error } = await supabase
    .from("execution_queue")
    .select(
      "id, run_id, flow_id, test_case_id, project_id, status, trigger_type, environment, payload, created_at"
    )
    .in("status", ["pending", "running"])
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Also grab the version_id from test_runs_v2 for each item, since the
  // execution_queue doesn't store it but RunJobPayload needs it.
  const runIds = (items ?? []).map((i: Record<string, unknown>) => i.run_id);
  let versionMap: Record<string, string | null> = {};

  if (runIds.length > 0) {
    const { data: runs } = await supabase
      .from("test_runs_v2")
      .select("id, version_id")
      .in("id", runIds);

    for (const r of runs ?? []) {
      versionMap[r.id] = r.version_id;
    }
  }

  const jobs = (items ?? []).map((item: Record<string, unknown>) => ({
    runId: item.run_id,
    flowId: item.flow_id,
    testCaseId: item.test_case_id,
    projectId: item.project_id,
    triggerType: item.trigger_type ?? "manual",
    versionId: versionMap[item.run_id as string] ?? null,
    environment: item.environment,
    idempotencyKey:
      (item.payload as Record<string, unknown>)?.idempotencyKey ??
      `${item.flow_id}:${item.run_id}`,
    status: item.status,
    createdAt: item.created_at
  }));

  return new Response(JSON.stringify(jobs), {
    headers: { "Content-Type": "application/json" }
  });
});
