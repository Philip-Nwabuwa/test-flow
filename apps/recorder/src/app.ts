import path from "node:path";
import { createServer } from "node:http";
import net from "node:net";
import type { IncomingMessage } from "node:http";

import express, { type Express } from "express";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";

import { verifyAuthoringToken } from "@automation/shared";

import type { RecorderEnv } from "./env.js";
import { SessionManager } from "./services/session-manager.js";

interface RecorderApp {
  app: Express;
  server: ReturnType<typeof createServer>;
}

function buildEmbedHtml(sessionId: string, token: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Live Authoring Session</title>
    <style>
      html, body, #screen {
        width: 100%;
        height: 100%;
        margin: 0;
        background: #111827;
      }

      #screen canvas {
        width: 100% !important;
        height: 100% !important;
      }
    </style>
  </head>
  <body>
    <div id="screen"></div>
    <script type="module">
      import RFB from "/novnc/core/rfb.js";

      const token = ${JSON.stringify(token)};
      const sessionId = ${JSON.stringify(sessionId)};
      const url = new URL("/ws/" + encodeURIComponent(sessionId) + "?token=" + encodeURIComponent(token), window.location.href);
      url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

      const rfb = new RFB(document.getElementById("screen"), url.toString());
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.showDotCursor = true;

      const blockedKeys = new Set([
        "Backspace",
        "Delete",
        "Enter",
        " "
      ]);

      const allowedNavigationKeys = new Set([
        "Tab",
        "Escape",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
        "PageUp",
        "PageDown"
      ]);

      const shouldBlock = (event) => {
        if (allowedNavigationKeys.has(event.key)) {
          return false;
        }

        if (blockedKeys.has(event.key)) {
          return true;
        }

        return event.key.length === 1;
      };

      document.addEventListener("keydown", (event) => {
        if (!shouldBlock(event)) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);

      document.addEventListener("keypress", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);

      document.addEventListener("paste", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    </script>
  </body>
</html>`;
}

export function createApp(env: RecorderEnv, manager: SessionManager): RecorderApp {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/novnc", express.static(path.resolve(env.NOVNC_STATIC_DIR)));

  app.get("/health/live", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/embed/:sessionId", async (req, res, next) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      if (!token) {
        res.status(401).send("Missing authoring token");
        return;
      }

      const claims = await verifyAuthoringToken(env.AUTHORING_TOKEN_SECRET, token);
      if (claims.purpose !== "embed" || claims.sessionId !== String(req.params.sessionId)) {
        res.status(401).send("Invalid authoring token");
        return;
      }

      const session = await manager.getSession(String(req.params.sessionId));
      if (!session || session.userId !== claims.userId) {
        res.status(404).send("Authoring session not found");
        return;
      }

      res.setHeader("Content-Security-Policy", `frame-ancestors ${env.AUTHORING_ALLOWED_FRAME_ANCESTORS}`);
      res.type("html").send(buildEmbedHtml(String(req.params.sessionId), token));
    } catch (error) {
      next(error);
    }
  });

  app.use("/internal", (req, res, next) => {
    if (req.header("x-recorder-key") !== env.RECORDER_INTERNAL_KEY) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  app.post("/internal/sessions", async (req, res, next) => {
    try {
      const session = await manager.createSession({
        sessionId: randomUUID(),
        userId: String(req.body.userId),
        projectId: String(req.body.projectId),
        flowId: typeof req.body.flowId === "string" ? req.body.flowId : null,
        targetUrl: String(req.body.targetUrl)
      });
      res.status(201).json(session);
    } catch (error) {
      next(error);
    }
  });

  app.get("/internal/sessions/:sessionId", async (req, res, next) => {
    try {
      const session = await manager.getSession(String(req.params.sessionId));
      if (!session) {
        res.status(404).json({ error: "Authoring session not found" });
        return;
      }

      res.json(session);
    } catch (error) {
      next(error);
    }
  });

  app.post("/internal/sessions/:sessionId/input", async (req, res, next) => {
    try {
      res.json(await manager.submitInput(String(req.params.sessionId), req.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/internal/sessions/:sessionId/pause", async (req, res, next) => {
    try {
      res.json(await manager.pause(String(req.params.sessionId)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/internal/sessions/:sessionId/resume", async (req, res, next) => {
    try {
      res.json(await manager.resume(String(req.params.sessionId)));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/internal/sessions/:sessionId", async (req, res, next) => {
    try {
      await manager.endSession(String(req.params.sessionId));
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    const message = error instanceof Error ? error.message : "Recorder request failed";
    res.status(500).json({ error: message });
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (websocket: WebSocket, request: IncomingMessage) => {
    const match = request.url?.match(/^\/ws\/([^/?]+)/);
    if (!match) {
      websocket.close();
      return;
    }

    const sessionId = decodeURIComponent(match[1]);
    const vncPort = manager.getSessionVncPort(sessionId);
    if (!vncPort) {
      websocket.close();
      return;
    }

    const socket = net.createConnection({ host: "127.0.0.1", port: vncPort });
    socket.on("data", (chunk) => websocket.send(chunk, { binary: true }));
    socket.on("error", () => websocket.close());
    socket.on("close", () => websocket.close());

    websocket.on("message", (payload: RawData) => {
      socket.write(payload as Buffer);
    });
    websocket.on("close", () => {
      socket.destroy();
    });
  });

  server.on("upgrade", async (request, socket, head) => {
    try {
      if (!request.url?.startsWith("/ws/")) {
        socket.destroy();
        return;
      }

      const url = new URL(request.url, "http://localhost");
      const token = url.searchParams.get("token") ?? "";
      const sessionId = decodeURIComponent(url.pathname.replace(/^\/ws\//, ""));
      const claims = await verifyAuthoringToken(env.AUTHORING_TOKEN_SECRET, token);
      if (claims.purpose !== "embed" || claims.sessionId !== sessionId) {
        socket.destroy();
        return;
      }

      const session = await manager.getSession(sessionId);
      if (!session || session.userId !== claims.userId || !manager.getSessionVncPort(sessionId)) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
        wss.emit("connection", websocket, request);
      });
    } catch {
      socket.destroy();
    }
  });

  return { app, server };
}
