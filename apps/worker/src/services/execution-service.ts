import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  classifyFailure,
  decrypt,
  type FlowStepResult,
  type RunJobPayload
} from "@automation/shared";

import type { RuntimeResult } from "../lib/docker-runtime.js";
import { EdgeClient, type ExecutionContext } from "../lib/edge-client.js";

interface TestRuntime {
  run(payload: Record<string, unknown>): Promise<RuntimeResult>;
}

export class ExecutionService {
  constructor(
    private readonly edgeClient: EdgeClient,
    private readonly runtime: TestRuntime,
    private readonly variableKey: string
  ) {}

  async process(payload: RunJobPayload) {
    const runPayload = payload.runId ? payload : await this.createScheduledRun(payload);
    if (!runPayload) {
      return;
    }
    const runId = runPayload.runId;
    let context: ExecutionContext | undefined;
    let workspaceDir: string | undefined;
    let resultPath: string | undefined;

    try {
      await this.edgeClient.markRunStarted(runId);
      context = await this.edgeClient.loadContext(runPayload);

      const decryptedVariables: Record<string, string> = {};
      for (const [name, cipher] of Object.entries(context.variables)) {
        try {
          decryptedVariables[name] = decrypt(this.variableKey, cipher);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to decrypt variable ${name}: ${detail}`);
        }
      }

      const runtimeResult = await this.runtime.run({
        runId,
        targetUrl: context.targetUrl,
        steps: context.steps,
        variables: decryptedVariables
      });
      workspaceDir = runtimeResult.workspaceDir;
      resultPath = runtimeResult.resultPath;

      const rawResult = await readFile(runtimeResult.resultPath, "utf8");
      const parsed = JSON.parse(rawResult) as {
        status: "passed" | "failed";
        errorMessage?: string;
        stepResults: FlowStepResult[];
        finalScreenshot?: string;
      };

      // v1: skip artifact uploads (no service_role key for storage)

      await this.edgeClient.completeRun({
        runId,
        flowId: context.flowId,
        testCaseId: context.testCaseId,
        status: parsed.status,
        errorMessage: parsed.errorMessage ?? null,
        stepResults: parsed.stepResults,
        screenshotPath: null,
        hydratedSteps: parsed.stepResults
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown execution error";
      const classification = classifyFailure(message);

      await this.edgeClient.failRun({
        runId,
        flowId: context?.flowId ?? payload.flowId,
        errorMessage: message
      });

      if (classification === "infrastructure") {
        throw error;
      }
    } finally {
      if (workspaceDir ?? resultPath) {
        await rm(workspaceDir ?? path.dirname(resultPath!), { recursive: true, force: true });
      }
    }
  }

  private async createScheduledRun(payload: RunJobPayload): Promise<RunJobPayload | null> {
    return this.edgeClient.createScheduledRun(payload);
  }
}
