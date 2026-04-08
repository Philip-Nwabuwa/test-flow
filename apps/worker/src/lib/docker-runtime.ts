import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Resolve the Playwright runner relative to THIS source file rather than
// process.cwd(). The worker can be launched from anywhere (repo root,
// apps/worker/, a script in src/scripts/, etc.) and bind-mounting a
// non-existent host path silently creates an empty directory inside the
// container on Docker Desktop — yielding a confusing "Cannot find module"
// from node instead of a real error.
const RUNNER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../runner/execute-flow.mjs"
);

interface ExecError extends Error {
  stderr?: string;
  stdout?: string;
  code?: number;
}

export interface RuntimeResult {
  resultPath: string;
  workspaceDir: string;
}

export class DockerRuntime {
  constructor(
    private readonly image: string,
    private readonly network: string,
    private readonly timeoutMs: number
  ) {}

  async run(payload: Record<string, unknown>): Promise<RuntimeResult> {
    // Fail fast if the runner is missing — otherwise Docker Desktop silently
    // mounts an empty directory and we get a misleading "Cannot find module"
    // from node inside the container.
    try {
      await access(RUNNER_PATH);
    } catch {
      throw new Error(
        `Playwright runner not found at ${RUNNER_PATH}. ` +
          "Check that apps/worker/runner/execute-flow.mjs exists in the deployed worker bundle."
      );
    }

    const workspaceDir = await mkdtemp(path.join(tmpdir(), "flow-run-"));
    const payloadPath = path.join(workspaceDir, "payload.json");
    const outputDir = path.join(workspaceDir, "output");
    const resultPath = path.join(outputDir, "result.json");

    await writeFile(payloadPath, JSON.stringify(payload, null, 2), "utf8");

    let dockerError: ExecError | undefined;
    try {
      await execFileAsync(
        "docker",
        [
          "run",
          "--rm",
          "--init",
          "--ipc=host",
          "--network",
          this.network,
          "-v",
          `${RUNNER_PATH}:/runner/execute-flow.mjs:ro`,
          "-v",
          `${workspaceDir}:/work`,
          this.image,
          "node",
          "/runner/execute-flow.mjs",
          "/work/payload.json",
          "/work/output"
        ],
        {
          timeout: this.timeoutMs,
          maxBuffer: 10 * 1024 * 1024
        }
      );
    } catch (err) {
      dockerError = err as ExecError;
    }

    // If docker exited non-zero AND the runner never wrote result.json, this
    // is an infrastructure-level failure (image missing, mount denied, runner
    // crashed before its try/catch, etc.) — surface the docker stderr so the
    // caller gets a real diagnostic instead of a downstream ENOENT.
    if (dockerError) {
      let resultExists = false;
      try {
        await access(resultPath);
        resultExists = true;
      } catch {
        resultExists = false;
      }

      if (!resultExists) {
        const stderr = dockerError.stderr?.trim() ?? "";
        const stdout = dockerError.stdout?.trim() ?? "";
        const detail = stderr || stdout || dockerError.message;
        throw new Error(`Playwright runtime failed before writing result.json: ${detail}`);
      }
      // result.json exists → functional failure, caller will parse it.
    }

    return {
      workspaceDir,
      resultPath
    };
  }
}
