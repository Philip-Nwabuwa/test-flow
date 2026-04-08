import { Router, type Router as ExpressRouter } from "express";

import { asyncHandler } from "../lib/http.js";
import { DashboardService } from "../services/dashboard-service.js";

export function createDashboardRoutes(service: DashboardService): ExpressRouter {
  const router = Router();

  router.get(
    "/summary",
    asyncHandler(async (req, res) => {
      res.json(await service.summary(req.supabase!, req.auth!));
    })
  );

  router.get(
    "/problems",
    asyncHandler(async (req, res) => {
      res.json(await service.problems(req.supabase!, req.auth!));
    })
  );

  router.get(
    "/insights",
    asyncHandler(async (req, res) => {
      res.json(await service.insights(req.supabase!, req.auth!));
    })
  );

  router.get(
    "/history",
    asyncHandler(async (req, res) => {
      res.json(
        await service.history(req.supabase!, req.auth!, {
          status: typeof req.query.status === "string" ? req.query.status : undefined,
          trigger: typeof req.query.trigger === "string" ? req.query.trigger : undefined,
          flowId: typeof req.query.flowId === "string" ? req.query.flowId : undefined
        })
      );
    })
  );

  return router;
}
