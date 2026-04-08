import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { RuntimeResult } from "./docker-runtime.js";

const execFileAsync = promisify(execFile);

const RUNNER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../runner/execute-flow.mjs"
);

interface ExecError extends Error {
  stderr?: string;
  stdout?: string;
  code?: number;
}

/**
 * Runs execute-flow.mjs directly via node/bun — no Docker needed.
 * Requires Playwright + browsers to be installed in the host environment.
 */
export class DirectRuntime {
  constructor(private readonly timeoutMs: number) {}

  async run(payload: Record<string, unknown>): Promise<RuntimeResult> {
    const workspaceRoot = process.env.WORKER_WORKSPACE_ROOT ?? "/tmp";
    const workspaceDir = await mkdtemp(path.join(workspaceRoot, "flow-run-"));
    const payloadPath = path.join(workspaceDir, "payload.json");
    const outputDir = path.join(workspaceDir, "output");
    const resultPath = path.join(outputDir, "result.json");

    await writeFile(payloadPath, JSON.stringify(payload, null, 2), "utf8");

    let execError: ExecError | undefined;
    try {
      await execFileAsync(
        "node",
        [RUNNER_PATH, payloadPath, outputDir],
        {
          timeout: this.timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...process.env,
            PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/ms-playwright"
          }
        }
      );
    } catch (err) {
      execError = err as ExecError;
    }

    if (execError) {
      let resultExists = false;
      try {
        const { access } = await import("node:fs/promises");
        await access(resultPath);
        resultExists = true;
      } catch {
        resultExists = false;
      }

      if (!resultExists) {
        const stderr = execError.stderr?.trim() ?? "";
        const stdout = execError.stdout?.trim() ?? "";
        const detail = stderr || stdout || execError.message;
        throw new Error(`Playwright runtime failed before writing result.json: ${detail}`);
      }
    }

    return { workspaceDir, resultPath };
  }
}
