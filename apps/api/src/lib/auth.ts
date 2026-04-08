import { createRemoteJWKSet, jwtVerify } from "jose";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type AuthContext, throwIfError } from "@automation/shared";

import { HttpError } from "./http.js";

interface VerifiedClaims {
  sub: string;
  email?: string;
}

export class AuthService {
  private readonly jwks;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly issuer: string,
    private readonly audience: string,
    jwksUrl: string
  ) {
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  async verifyToken(token: string): Promise<VerifiedClaims> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: this.audience
    });

    return {
      sub: String(payload.sub),
      email: typeof payload.email === "string" ? payload.email : undefined
    };
  }

  async resolveContext(token: string): Promise<AuthContext> {
    const claims = await this.verifyToken(token);

    const result = await this.supabase.rpc("rpc_resolve_auth_context", {
      p_user_id: claims.sub
    });

    const rows = throwIfError(result);

    if (!rows || (Array.isArray(rows) && rows.length === 0)) {
      throw new HttpError(401, "User profile was not found");
    }

    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      userId: row.user_id,
      email: row.email ?? claims.email ?? null,
      spaceIds: row.space_ids ?? [],
      projectIds: row.project_ids ?? [],
      roles: row.roles ?? [],
      token
    };
  }
}
