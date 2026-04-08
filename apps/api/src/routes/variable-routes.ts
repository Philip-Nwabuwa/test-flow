import { Router, type Router as ExpressRouter } from "express";

import { variableSchema } from "@automation/shared";

import { asyncHandler } from "../lib/http.js";
import { VariableService } from "../services/variable-service.js";

export function createVariableRoutes(service: VariableService): ExpressRouter {
  const router = Router();

  router.get(
    "/variables",
    asyncHandler(async (req, res) => {
      res.json(await service.list(req.supabase!, req.auth!));
    })
  );

  router.post(
    "/variables",
    asyncHandler(async (req, res) => {
      const payload = variableSchema.parse(req.body);
      res.status(201).json(await service.create(req.supabase!, req.auth!, payload));
    })
  );

  router.patch(
    "/variables/:variableId",
    asyncHandler(async (req, res) => {
      const payload = variableSchema.partial().parse(req.body);
      res.json(await service.update(req.supabase!, req.auth!, String(req.params.variableId), payload));
    })
  );

  router.delete(
    "/variables/:variableId",
    asyncHandler(async (req, res) => {
      await service.remove(req.supabase!, req.auth!, String(req.params.variableId));
      res.status(204).end();
    })
  );

  return router;
}
