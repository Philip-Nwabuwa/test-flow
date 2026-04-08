import type { SupabaseClient } from "@supabase/supabase-js";
import { Router, type Router as ExpressRouter } from "express";

import { asyncHandler } from "../lib/http.js";
import { OpsService } from "../services/ops-service.js";
import { ScheduleService } from "../services/schedule-service.js";

export function createInternalRoutes(
  service: ScheduleService,
  opsService: OpsService,
  anonClient: SupabaseClient
): ExpressRouter {
  const router = Router();

  router.post(
    "/reconcile-schedules",
    asyncHandler(async (_req, res) => {
      await service.reconcile(anonClient);
      res.json({ ok: true });
    })
  );

  router.get(
    "/queues",
    asyncHandler(async (_req, res) => {
      res.json(await opsService.queueStats());
    })
  );

  router.get(
    "/queues/failed",
    asyncHandler(async (req, res) => {
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      res.json(await opsService.failedJobs(limit));
    })
  );

  return router;
}
