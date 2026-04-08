import { Router, type Router as ExpressRouter } from "express";

import { asyncHandler } from "../lib/http.js";

export function createSystemRoutes(deps: {
  ready: () => Promise<boolean>;
}): ExpressRouter {
  const router = Router();

  router.get(
    "/health/live",
    asyncHandler(async (_req, res) => {
      res.json({ ok: true });
    })
  );

  router.get(
    "/health/ready",
    asyncHandler(async (_req, res) => {
      const ok = await deps.ready();
      res.status(ok ? 200 : 503).json({ ok });
    })
  );

  return router;
}

export function createIdentityRoutes(): ExpressRouter {
  const router = Router();

  router.get(
    "/me",
    asyncHandler(async (req, res) => {
      res.json(req.auth);
    })
  );

  return router;
}
