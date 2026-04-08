import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

function resolveValue(value, variables) {
  if (!value) {
    return value;
  }

  return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, name) => variables[name] ?? "");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  const payloadPath = process.argv[2];
  const outputDir = process.argv[3];
  await ensureDir(outputDir);

  const payload = JSON.parse(await fs.readFile(payloadPath, "utf8"));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const stepResults = [];
  let finalScreenshot = null;

  try {
    for (const step of payload.steps) {
      const startedAt = new Date();
      try {
        const value = resolveValue(step.value, payload.variables);
        const expectedOutcome = resolveValue(step.expectedOutcome, payload.variables);
        const timeout = step.timeoutMs ?? 30_000;

        switch (step.actionType) {
          case "navigate":
            await page.goto(value ?? payload.targetUrl, { waitUntil: "networkidle", timeout });
            break;
          case "click":
            await page.locator(step.selector).click({ timeout });
            break;
          case "input":
            await page.locator(step.selector).fill(value ?? "", { timeout });
            break;
          case "select":
            await page.locator(step.selector).selectOption(value ?? "", { timeout });
            break;
          case "wait":
            if (step.selector) {
              await page.locator(step.selector).waitFor({ timeout });
            } else {
              await page.waitForTimeout(Number(value ?? 1000));
            }
            break;
          case "scroll":
            if (step.selector) {
              await page.locator(step.selector).scrollIntoViewIfNeeded({ timeout });
            } else {
              await page.mouse.wheel(0, Number(value ?? 800));
            }
            break;
          case "KeyPress":
            await page.keyboard.press(value ?? "Enter");
            break;
          case "assert":
            if (step.selector && expectedOutcome) {
              const text = await page.locator(step.selector).textContent({ timeout });
              if (!text?.includes(expectedOutcome)) {
                throw new Error(`Expected selector ${step.selector} to include "${expectedOutcome}"`);
              }
            } else if (step.selector) {
              await page.locator(step.selector).waitFor({ state: "visible", timeout });
            } else if (expectedOutcome) {
              const body = await page.textContent("body");
              if (!body?.includes(expectedOutcome)) {
                throw new Error(`Expected page to include "${expectedOutcome}"`);
              }
            } else {
              throw new Error("Assert step requires a selector or expectedOutcome");
            }
            break;
          default:
            throw new Error(`Unsupported action type: ${step.actionType}`);
        }

        stepResults.push({
          stepOrder: step.sortOrder,
          actionType: step.actionType,
          semanticLabel: step.semanticLabel,
          status: "passed",
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime()
        });
      } catch (error) {
        const screenshotName = `step-${step.sortOrder}-failure.png`;
        await page.screenshot({ path: path.join(outputDir, screenshotName), fullPage: true });

        stepResults.push({
          stepOrder: step.sortOrder,
          actionType: step.actionType,
          semanticLabel: step.semanticLabel,
          status: "failed",
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          errorMessage: error instanceof Error ? error.message : "Unknown step error",
          screenshotPath: screenshotName
        });

        finalScreenshot = screenshotName;
        throw error;
      }
    }

    finalScreenshot = "final.png";
    await page.screenshot({ path: path.join(outputDir, finalScreenshot), fullPage: true });

    await fs.writeFile(
      path.join(outputDir, "result.json"),
      JSON.stringify(
        {
          status: "passed",
          stepResults,
          finalScreenshot
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    await fs.writeFile(
      path.join(outputDir, "result.json"),
      JSON.stringify(
        {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown execution error",
          stepResults,
          finalScreenshot
        },
        null,
        2
      ),
      "utf8"
    );
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
