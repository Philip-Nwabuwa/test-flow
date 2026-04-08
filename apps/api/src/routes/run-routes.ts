import { Router, type Router as ExpressRouter } from "express";

import { runCreateSchema } from "@automation/shared";

import { asyncHandler } from "../lib/http.js";
import { RunService } from "../services/run-service.js";

export function createRunRoutes(service: RunService, pollMs: number): ExpressRouter {
  const router = Router();

  router.post(
    "/flows/:flowId/runs",
    asyncHandler(async (req, res) => {
      const payload = runCreateSchema.parse(req.body);
      res.status(201).json(await service.createManualRun(req.supabase!, req.auth!, String(req.params.flowId), payload));
    })
  );

  router.get(
    "/flows/:flowId/runs",
    asyncHandler(async (req, res) => {
      res.json(await service.listForFlow(req.supabase!, req.auth!, String(req.params.flowId)));
    })
  );

  router.get(
    "/runs/:runId",
    asyncHandler(async (req, res) => {
      res.json(await service.getRun(req.supabase!, req.auth!, String(req.params.runId)));
    })
  );

  router.get(
    "/runs/:runId/steps",
    asyncHandler(async (req, res) => {
      const run = await service.getRun(req.supabase!, req.auth!, String(req.params.runId));
      res.json(run.stepResults);
    })
  );

  router.get(
    "/runs/:runId/artifacts",
    asyncHandler(async (req, res) => {
      res.json(await service.getArtifacts(req.supabase!, req.auth!, String(req.params.runId)));
    })
  );

  router.post(
    "/runs/:runId/retry",
    asyncHandler(async (req, res) => {
      res.status(201).json(await service.retry(req.supabase!, req.auth!, String(req.params.runId)));
    })
  );

  router.post(
    "/runs/:runId/cancel",
    asyncHandler(async (req, res) => {
      res.json(await service.cancel(req.supabase!, req.auth!, String(req.params.runId)));
    })
  );

  router.get("/runs/:runId/events", async (req, res, next) => {
    try {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });

      let lastPayload = "";
      const sendCurrent = async () => {
        const run = await service.getRun(req.supabase!, req.auth!, String(req.params.runId));
        const payload = JSON.stringify(run);
        if (payload !== lastPayload) {
          res.write(`data: ${payload}\n\n`);
          lastPayload = payload;
        }
      };

      await sendCurrent();
      const interval = setInterval(() => {
        void sendCurrent().catch(next);
      }, pollMs);

      req.on("close", () => {
        clearInterval(interval);
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
