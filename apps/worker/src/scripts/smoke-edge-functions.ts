// Smoke test for the three deployed Supabase edge functions.
//
// Tier 1 runs always and needs no seed data. Tier 2 runs when
// SMOKE_FLOW_ID / SMOKE_TEST_CASE_ID / SMOKE_PROJECT_ID are set and
// exercises the full create-run -> load-context -> start -> fail chain.
//
// Usage:
//   export EDGE_FUNCTION_URL="https://<project>.supabase.co/functions/v1"
//   export EDGE_FUNCTION_KEY="<key>"
//   bun apps/worker/src/scripts/smoke-edge-functions.ts

import type { RunJobPayload } from "@automation/shared";

import { EdgeClient } from "../lib/edge-client.js";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const edgeUrl = process.env.EDGE_FUNCTION_URL;
const edgeKey = process.env.EDGE_FUNCTION_KEY;

if (!edgeUrl || !edgeKey) {
  console.error(
    "Missing EDGE_FUNCTION_URL or EDGE_FUNCTION_KEY in environment."
  );
  process.exit(2);
}

let failures = 0;
let passes = 0;

function pass(label: string, detail?: string): void {
  passes += 1;
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label: string, detail: string): void {
  failures += 1;
  console.log(`  FAIL  ${label} — ${detail}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const client = new EdgeClient(edgeUrl, edgeKey);
const badClient = new EdgeClient(edgeUrl, "definitely-not-the-real-key");

async function tier1(): Promise<void> {
  section("Tier 1 — no seed data required");

  // 1. Auth rejection.
  try {
    await badClient.reconcileSchedules();
    fail(
      "auth rejection",
      "expected a 401 rejection but call resolved successfully"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("401")) {
      pass("auth rejection", "got 401 as expected");
    } else {
      fail("auth rejection", `expected 401, got: ${msg}`);
    }
  }

  // 2. worker-schedule reconcile happy path.
  try {
    const schedules = await client.reconcileSchedules();
    if (Array.isArray(schedules)) {
      pass(
        "worker-schedule reconcile",
        `returned array (len=${schedules.length})`
      );
    } else {
      fail(
        "worker-schedule reconcile",
        `expected array, got: ${typeof schedules}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("worker-schedule reconcile", msg);
  }

  // 3. worker-load-context 404 path.
  try {
    const bogusPayload: RunJobPayload = {
      runId: ZERO_UUID,
      flowId: ZERO_UUID,
      testCaseId: ZERO_UUID,
      projectId: ZERO_UUID,
      triggerType: "manual",
      versionId: null,
      environment: null,
      idempotencyKey: "smoke-bogus"
    };
    await client.loadContext(bogusPayload);
    fail(
      "worker-load-context 404",
      "expected 404 rejection but call resolved"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404") && msg.includes("Flow context not found")) {
      pass("worker-load-context 404", "got expected 404 body");
    } else {
      fail(
        "worker-load-context 404",
        `expected 404 + "Flow context not found", got: ${msg}`
      );
    }
  }

  // 4. worker-update-run unknown action.
  try {
    const res = await fetch(`${edgeUrl}/worker-update-run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${edgeKey}`
      },
      body: JSON.stringify({ action: "bogus" })
    });
    const text = await res.text();
    if (res.status === 400 && text.includes("Unknown action: bogus")) {
      pass("worker-update-run unknown action", "got 400 + expected body");
    } else {
      fail(
        "worker-update-run unknown action",
        `expected 400 + "Unknown action: bogus", got ${res.status}: ${text}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("worker-update-run unknown action", msg);
  }
}

async function tier2(): Promise<void> {
  const flowId = process.env.SMOKE_FLOW_ID;
  const testCaseId = process.env.SMOKE_TEST_CASE_ID;
  const projectId = process.env.SMOKE_PROJECT_ID;
  const environment = process.env.SMOKE_ENVIRONMENT ?? null;

  if (!flowId || !testCaseId || !projectId) {
    section(
      "Tier 2 — skipped (set SMOKE_FLOW_ID, SMOKE_TEST_CASE_ID, SMOKE_PROJECT_ID to run)"
    );
    return;
  }

  section("Tier 2 — end-to-end run lifecycle");

  // 1. Create a run via worker-schedule.
  const seedPayload: RunJobPayload = {
    runId: ZERO_UUID, // replaced by worker-schedule
    flowId,
    testCaseId,
    projectId,
    triggerType: "manual",
    versionId: null,
    environment,
    idempotencyKey: `smoke-${Date.now()}`
  };

  let created: RunJobPayload | null;
  try {
    created = await client.createScheduledRun(seedPayload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("worker-schedule create-run", msg);
    return;
  }

  if (created === null) {
    pass(
      "worker-schedule create-run",
      "returned null (overlapping run exists) — remaining steps skipped"
    );
    return;
  }

  if (!created.runId || created.runId === ZERO_UUID) {
    fail(
      "worker-schedule create-run",
      `expected a fresh runId, got: ${JSON.stringify(created)}`
    );
    return;
  }

  pass("worker-schedule create-run", `runId=${created.runId}`);
  const runId = created.runId;

  // 2. Load context for the run we just created.
  try {
    const ctx = await client.loadContext({
      ...seedPayload,
      runId,
      versionId: created.versionId ?? null
    });

    if (typeof ctx.targetUrl !== "string" || ctx.targetUrl.length === 0) {
      fail(
        "worker-load-context happy path",
        `targetUrl missing or empty: ${JSON.stringify(ctx.targetUrl)}`
      );
    } else if (!Array.isArray(ctx.steps)) {
      fail(
        "worker-load-context happy path",
        `steps not an array: ${typeof ctx.steps}`
      );
    } else if (!ctx.variables || typeof ctx.variables !== "object") {
      fail(
        "worker-load-context happy path",
        `variables not an object: ${typeof ctx.variables}`
      );
    } else {
      pass(
        "worker-load-context happy path",
        `targetUrl=${ctx.targetUrl} steps=${ctx.steps.length} vars=${Object.keys(ctx.variables).length}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("worker-load-context happy path", msg);
  }

  // 3. Start the run.
  try {
    await client.markRunStarted(runId);
    pass("worker-update-run start", `runId=${runId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("worker-update-run start", msg);
  }

  // 4. Fail the run (cleanup — do not leave a running row in test_runs_v2).
  try {
    await client.failRun({
      runId,
      flowId,
      errorMessage: "smoke test cleanup"
    });
    pass("worker-update-run fail", `runId=${runId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("worker-update-run fail", msg);
  }
}

async function main(): Promise<void> {
  console.log(`Smoke-testing edge functions at ${edgeUrl}`);
  await tier1();
  await tier2();

  console.log(`\nResults: ${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
