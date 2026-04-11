import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type AuthContext, throwIfError } from "@automation/shared";

import { HttpError } from "./http.js";

interface VerifiedClaims {
  sub: string;
  email?: string;
}

const textEncoder = new TextEncoder();

export class AuthService {
  private readonly jwks;
  private readonly jwtSecretKey?: Uint8Array;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly issuer: string,
    private readonly audience: string,
    jwksUrl: string,
    jwtSecret?: string
  ) {
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
    this.jwtSecretKey = jwtSecret ? textEncoder.encode(jwtSecret) : undefined;
  }

  async verifyToken(token: string): Promise<VerifiedClaims> {
    try {
      const header = decodeProtectedHeader(token);
      const payload = await (async () => {
        if (typeof header.alg === "string" && header.alg.startsWith("HS")) {
          if (!this.jwtSecretKey) {
            throw new HttpError(401, "Unsupported bearer token algorithm");
          }

          const result = await jwtVerify(token, this.jwtSecretKey, {
            issuer: this.issuer,
            audience: this.audience
          });
          return result.payload;
        }

        const result = await jwtVerify(token, this.jwks, {
          issuer: this.issuer,
          audience: this.audience
        });
        return result.payload;
      })();

      return {
        sub: String(payload.sub),
        email: typeof payload.email === "string" ? payload.email : undefined
      };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      throw new HttpError(401, "Invalid bearer token");
    }
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
