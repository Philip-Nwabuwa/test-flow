import express, { type Express } from "express";
import { pinoHttp } from "pino-http";

import { createAnonClient } from "@automation/shared";

import { AuthService } from "./lib/auth.js";
import { createRunQueue } from "./lib/queue.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createRateLimitMiddleware } from "./middleware/rate-limit.js";
import { createDashboardRoutes } from "./routes/dashboard-routes.js";
import { createFlowRoutes } from "./routes/flow-routes.js";
import { createInternalRoutes } from "./routes/internal-routes.js";
import { createRunRoutes } from "./routes/run-routes.js";
import { createScheduleRoutes } from "./routes/schedule-routes.js";
import { createIdentityRoutes, createSystemRoutes } from "./routes/system-routes.js";
import { createVariableRoutes } from "./routes/variable-routes.js";
import { DashboardService } from "./services/dashboard-service.js";
import { FlowService } from "./services/flow-service.js";
import { RunService } from "./services/run-service.js";
import { ScheduleService } from "./services/schedule-service.js";
import { VariableService } from "./services/variable-service.js";
import { OpsService } from "./services/ops-service.js";
import { createLogger } from "./lib/logger.js";
import type { AppEnv } from "./env.js";

interface AppInstance {
  app: Express;
  runQueue: ReturnType<typeof createRunQueue>;
}

export function createApp(env: AppEnv): AppInstance {
  const logger = createLogger(env.LOG_LEVEL);
  const app = express();

  const anonClient = createAnonClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  const authService = new AuthService(
    anonClient,
    env.SUPABASE_JWT_ISSUER,
    env.SUPABASE_JWT_AUDIENCE,
    env.SUPABASE_JWKS_URL
  );
  const runQueue = createRunQueue(env.REDIS_URL);

  const flowService = new FlowService();
  const dashboardService = new DashboardService();
  const runService = new RunService(runQueue);
  const scheduleService = new ScheduleService(runQueue);
  const variableService = new VariableService(env.VARIABLE_ENCRYPTION_KEY);
  const opsService = new OpsService(runQueue);

  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));
  app.use(createRateLimitMiddleware(env.RATE_LIMIT_WINDOW_MS, env.RATE_LIMIT_MAX_REQUESTS));

  app.use(
    "/v1",
    createSystemRoutes({
      ready: async () => {
        const { error } = await anonClient.from("profiles").select("id").limit(1);
        return !error;
      }
    })
  );
  app.use("/v1", createAuthMiddleware(authService, env.SUPABASE_URL, env.SUPABASE_ANON_KEY));
  app.use("/v1", createIdentityRoutes());
  app.use("/v1/dashboard", createDashboardRoutes(dashboardService));
  app.use("/v1/flows", createFlowRoutes(flowService));
  app.use("/v1", createRunRoutes(runService, env.SSE_POLL_MS));
  app.use("/v1", createScheduleRoutes(scheduleService));
  app.use("/v1", createVariableRoutes(variableService));
  app.use("/internal", createInternalRoutes(scheduleService, opsService, anonClient));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return {
    app,
    runQueue
  };
}
