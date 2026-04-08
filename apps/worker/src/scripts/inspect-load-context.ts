// Direct probe of the worker-load-context edge function. Read-only — does
// not enqueue, does not write to the DB. Use this to isolate whether a
// 502 / 500 / 4xx is a function-side issue or a worker-side issue.
//
// Usage:
//   export EDGE_FUNCTION_URL="https://<project>.supabase.co/functions/v1"
//   export EDGE_FUNCTION_KEY="<key>"
//   bun apps/worker/src/scripts/inspect-load-context.ts <flowId> <testCaseId> <projectId> [environment]

import { EdgeClient } from "../lib/edge-client.js";

const edgeUrl = process.env.EDGE_FUNCTION_URL;
const edgeKey = process.env.EDGE_FUNCTION_KEY;

if (!edgeUrl || !edgeKey) {
  console.error("Missing EDGE_FUNCTION_URL or EDGE_FUNCTION_KEY in environment.");
  process.exit(2);
}

const [flowId, testCaseId, projectId, environment] = process.argv.slice(2);

if (!flowId || !testCaseId || !projectId) {
  console.error(
    "Usage: bun apps/worker/src/scripts/inspect-load-context.ts <flowId> <testCaseId> <projectId> [environment]"
  );
  process.exit(2);
}

const client = new EdgeClient(edgeUrl, edgeKey);

const fakeRunId = "00000000-0000-0000-0000-000000000000";

console.log(`Calling worker-load-context against ${edgeUrl}`);
console.log(`  flowId=${flowId}`);
console.log(`  testCaseId=${testCaseId}`);
console.log(`  projectId=${projectId}`);
console.log(`  environment=${environment ?? "(none)"}`);
console.log("");

try {
  const ctx = await client.loadContext({
    runId: fakeRunId,
    flowId,
    testCaseId,
    projectId,
    triggerType: "manual",
    versionId: null,
    environment: environment ?? null,
    idempotencyKey: "inspect-probe"
  });

  console.log("SUCCESS — response:");
  console.log(JSON.stringify(ctx, null, 2));
  console.log("");
  console.log(
    `Summary: targetUrl=${ctx.targetUrl} steps=${ctx.steps.length} vars=${Object.keys(ctx.variables).length}`
  );
} catch (err) {
  console.error("FAILED:");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
