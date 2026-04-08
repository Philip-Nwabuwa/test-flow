import type { NextFunction, Request, Response } from "express";

import { ZodError } from "zod";

import { HttpError } from "../lib/http.js";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, "Route not found"));
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    res.status(422).json({
      error: "ValidationError",
      issues: error.issues
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: error.message
    });
    return;
  }

  res.status(500).json({
    error: "Internal server error"
  });
}
