import type { NextFunction, Request, Response } from "express";

import { HttpError } from "../lib/http.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function createRateLimitMiddleware(windowMs: number, maxRequests: number) {
  const entries = new Map<string, RateLimitEntry>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip || req.header("x-forwarded-for") || "unknown";
    const current = entries.get(key);

    if (!current || current.resetAt <= now) {
      entries.set(key, {
        count: 1,
        resetAt: now + windowMs
      });
      res.setHeader("x-ratelimit-limit", String(maxRequests));
      res.setHeader("x-ratelimit-remaining", String(maxRequests - 1));
      return next();
    }

    if (current.count >= maxRequests) {
      res.setHeader("retry-after", String(Math.ceil((current.resetAt - now) / 1000)));
      return next(new HttpError(429, "Rate limit exceeded"));
    }

    current.count += 1;
    entries.set(key, current);
    res.setHeader("x-ratelimit-limit", String(maxRequests));
    res.setHeader("x-ratelimit-remaining", String(Math.max(maxRequests - current.count, 0)));
    next();
  };
}
