import type { NextFunction, Request, Response } from "express";

import { createUserClient } from "@automation/shared";

import { AuthService } from "../lib/auth.js";
import { HttpError } from "../lib/http.js";

export function createAuthMiddleware(
  authService: AuthService,
  supabaseUrl: string,
  supabaseAnonKey: string
) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const authorization = req.header("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      next(new HttpError(401, "Missing bearer token"));
      return;
    }

    try {
      const token = authorization.replace("Bearer ", "");
      req.auth = await authService.resolveContext(token);
      req.supabase = createUserClient(supabaseUrl, supabaseAnonKey, token);
      next();
    } catch (error) {
      next(error);
    }
  };
}
