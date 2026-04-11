import type { NextFunction, Request, Response } from "express";

import { ZodError } from "zod";

import { HttpError } from "../lib/http.js";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, "Route not found"));
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const logger = (req as Request & {
    log?: {
      error: (value: unknown, message?: string) => void;
    };
  }).log;

  if (error instanceof ZodError) {
    logger?.error({ error, issues: error.issues }, "Request validation failed");
    res.status(422).json({
      error: "ValidationError",
      issues: error.issues
    });
    return;
  }

  if (error instanceof HttpError) {
    logger?.error({ error }, "Request failed");
    res.status(error.statusCode).json({
      error: error.message
    });
    return;
  }

  logger?.error({ error }, "Unhandled request failure");
  res.status(500).json({
    error: "Internal server error"
  });
}
