import { Router, type Router as ExpressRouter } from "express";

import { authoringInputSubmitSchema, authoringSessionCreateSchema } from "@automation/shared";

import { asyncHandler, HttpError } from "../lib/http.js";
import { AuthoringSessionService } from "../services/authoring-session-service.js";

export function createAuthoringPublicRoutes(service: AuthoringSessionService): ExpressRouter {
  const router = Router();

  router.get("/authoring-sessions/:sessionId/events", async (req, res, next) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      if (!token) {
        throw new HttpError(401, "Missing authoring stream token");
      }

      await service.requireStreamAccess(String(req.params.sessionId), token);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });

      let lastId = req.header("last-event-id") ?? "0-0";
      const sendEvents = async (blockMs?: number) => {
        const events = await service.readEvents(String(req.params.sessionId), lastId, 100, blockMs);
        for (const event of events) {
          lastId = event.id;
          res.write(`id: ${event.id}\n`);
          res.write(`event: ${event.type}\n`);
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };

      const interval = setInterval(() => {
        res.write(": keepalive\n\n");
      }, 15000);

      let closed = false;
      req.on("close", () => {
        closed = true;
        clearInterval(interval);
      });

      await sendEvents();

      while (!closed) {
        await sendEvents(15000);
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createAuthoringRoutes(service: AuthoringSessionService): ExpressRouter {
  const router = Router();

  router.post(
    "/authoring-sessions",
    asyncHandler(async (req, res) => {
      const payload = authoringSessionCreateSchema.parse(req.body);
      res.status(201).json(await service.create(req.supabase!, req.auth!, payload));
    })
  );

  router.get(
    "/authoring-sessions/:sessionId",
    asyncHandler(async (req, res) => {
      res.json(await service.get(req.auth!, String(req.params.sessionId)));
    })
  );

  router.post(
    "/authoring-sessions/:sessionId/input",
    asyncHandler(async (req, res) => {
      const payload = authoringInputSubmitSchema.parse(req.body);
      res.json(await service.submitInput(req.auth!, String(req.params.sessionId), payload));
    })
  );

  router.post(
    "/authoring-sessions/:sessionId/pause",
    asyncHandler(async (req, res) => {
      res.json(await service.pause(req.auth!, String(req.params.sessionId)));
    })
  );

  router.post(
    "/authoring-sessions/:sessionId/resume",
    asyncHandler(async (req, res) => {
      res.json(await service.resume(req.auth!, String(req.params.sessionId)));
    })
  );

  router.delete(
    "/authoring-sessions/:sessionId",
    asyncHandler(async (req, res) => {
      res.json(await service.end(req.auth!, String(req.params.sessionId)));
    })
  );

  return router;
}
