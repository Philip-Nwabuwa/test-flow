import { Router, type Router as ExpressRouter } from "express";

import { flowCreateSchema, flowDraftPayloadSchema, flowUpdateSchema } from "@automation/shared";

import { asyncHandler } from "../lib/http.js";
import { FlowService } from "../services/flow-service.js";

export function createFlowRoutes(service: FlowService): ExpressRouter {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(
        await service.list(
          req.supabase!,
          req.auth!,
          typeof req.query.search === "string" ? req.query.search : undefined,
          typeof req.query.status === "string" ? req.query.status : undefined
        )
      );
    })
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const payload = flowCreateSchema.parse(req.body);
      res.status(201).json(await service.create(req.supabase!, req.auth!, payload));
    })
  );

  router.get(
    "/:flowId",
    asyncHandler(async (req, res) => {
      res.json(await service.getById(req.supabase!, req.auth!, String(req.params.flowId)));
    })
  );

  router.patch(
    "/:flowId",
    asyncHandler(async (req, res) => {
      const payload = flowUpdateSchema.parse(req.body);
      res.json(await service.update(req.supabase!, req.auth!, String(req.params.flowId), payload));
    })
  );

  router.post(
    "/:flowId/duplicate",
    asyncHandler(async (req, res) => {
      res.status(201).json(await service.duplicate(req.supabase!, req.auth!, String(req.params.flowId)));
    })
  );

  router.put(
    "/:flowId/draft",
    asyncHandler(async (req, res) => {
      const payload = flowDraftPayloadSchema.parse(req.body);
      res.json(await service.saveDraft(req.supabase!, req.auth!, String(req.params.flowId), payload));
    })
  );

  router.post(
    "/:flowId/publish",
    asyncHandler(async (req, res) => {
      res.status(201).json(await service.publish(req.supabase!, req.auth!, String(req.params.flowId)));
    })
  );

  router.get(
    "/:flowId/versions",
    asyncHandler(async (req, res) => {
      res.json(await service.listVersions(req.supabase!, req.auth!, String(req.params.flowId)));
    })
  );

  return router;
}
