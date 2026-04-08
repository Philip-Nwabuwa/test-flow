import { Router, type Router as ExpressRouter } from "express";

import { scheduleSchema, scheduleUpdateSchema } from "@automation/shared";

import { asyncHandler } from "../lib/http.js";
import { ScheduleService } from "../services/schedule-service.js";

export function createScheduleRoutes(service: ScheduleService): ExpressRouter {
  const router = Router();

  router.get(
    "/flows/:flowId/schedules",
    asyncHandler(async (req, res) => {
      res.json(await service.list(req.supabase!, req.auth!, String(req.params.flowId)));
    })
  );

  router.post(
    "/flows/:flowId/schedules",
    asyncHandler(async (req, res) => {
      const payload = scheduleSchema.parse(req.body);
      res.status(201).json(await service.create(req.supabase!, req.auth!, String(req.params.flowId), payload));
    })
  );

  router.patch(
    "/schedules/:scheduleId",
    asyncHandler(async (req, res) => {
      const payload = scheduleUpdateSchema.parse(req.body);
      res.json(await service.update(req.supabase!, req.auth!, String(req.params.scheduleId), payload));
    })
  );

  router.post(
    "/schedules/:scheduleId/pause",
    asyncHandler(async (req, res) => {
      res.json(await service.pause(req.supabase!, req.auth!, String(req.params.scheduleId)));
    })
  );

  router.post(
    "/schedules/:scheduleId/resume",
    asyncHandler(async (req, res) => {
      res.json(await service.resume(req.supabase!, req.auth!, String(req.params.scheduleId)));
    })
  );

  router.delete(
    "/schedules/:scheduleId",
    asyncHandler(async (req, res) => {
      await service.remove(req.supabase!, req.auth!, String(req.params.scheduleId));
      res.status(204).end();
    })
  );

  return router;
}
