import { SignJWT, jwtVerify } from "jose";
import type { Redis } from "ioredis";

import type {
  AuthoringEvent,
  AuthoringSession,
  AuthoringTokenClaims,
  AuthoringTokenPurpose
} from "./types.js";

const textEncoder = new TextEncoder();

function sessionKey(sessionId: string) {
  return `authoring:session:${sessionId}`;
}

function eventStreamKey(sessionId: string) {
  return `authoring:events:${sessionId}`;
}

function ownerKey(userId: string, ownerScope: string) {
  return `authoring:owner:${userId}:${ownerScope}`;
}

function tokenSecret(secret: string) {
  return textEncoder.encode(secret);
}

export function ownerScopeFor(projectId: string, flowId?: string | null) {
  return flowId ?? projectId;
}

export async function mintAuthoringToken(
  secret: string,
  claims: AuthoringTokenClaims,
  expiresInSeconds = 900
) {
  return new SignJWT({
    sessionId: claims.sessionId,
    userId: claims.userId,
    purpose: claims.purpose
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(tokenSecret(secret));
}

export async function verifyAuthoringToken(secret: string, token: string): Promise<AuthoringTokenClaims> {
  const { payload } = await jwtVerify(token, tokenSecret(secret));

  const purpose = String(payload.purpose) as AuthoringTokenPurpose;
  if (!["embed", "events"].includes(purpose)) {
    throw new Error("Invalid authoring token purpose");
  }

  return {
    sessionId: String(payload.sessionId),
    userId: String(payload.userId),
    purpose
  };
}

function parseSession(value: string | null): AuthoringSession | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as AuthoringSession;
}

function parseStreamEntries(entries: unknown): AuthoringEvent[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const [, records] = entries as [string, Array<[string, string[]]>];
  return (records ?? [])
    .map(([id, values]) => {
      const payloadIndex = values.findIndex((value) => value === "payload");
      const payload = payloadIndex >= 0 ? values[payloadIndex + 1] : undefined;
      if (!payload) {
        return null;
      }

      const event = JSON.parse(payload) as AuthoringEvent;
      return { ...event, id };
    })
    .filter((event): event is AuthoringEvent => event !== null);
}

export class AuthoringSessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly streamMaxLen = 1000
  ) {}

  async saveSession(session: AuthoringSession, ttlMs: number, writeOwner = true) {
    await this.redis.set(sessionKey(session.sessionId), JSON.stringify(session), "PX", ttlMs);
    if (writeOwner) {
      await this.redis.set(
        ownerKey(session.userId, ownerScopeFor(session.projectId, session.flowId)),
        session.sessionId,
        "PX",
        ttlMs
      );
    }
  }

  async getSession(sessionId: string) {
    return parseSession(await this.redis.get(sessionKey(sessionId)));
  }

  async getOwnerSession(userId: string, projectId: string, flowId?: string | null) {
    return this.redis.get(ownerKey(userId, ownerScopeFor(projectId, flowId)));
  }

  async deleteSession(session: Pick<AuthoringSession, "sessionId" | "userId" | "projectId" | "flowId">) {
    await this.redis.del(
      sessionKey(session.sessionId),
      eventStreamKey(session.sessionId),
      ownerKey(session.userId, ownerScopeFor(session.projectId, session.flowId))
    );
  }

  async clearOwnerSession(session: Pick<AuthoringSession, "userId" | "projectId" | "flowId">) {
    await this.redis.del(ownerKey(session.userId, ownerScopeFor(session.projectId, session.flowId)));
  }

  async deleteSessionData(sessionId: string) {
    await this.redis.del(sessionKey(sessionId), eventStreamKey(sessionId));
  }

  async appendEvent(sessionId: string, event: AuthoringEvent, ttlMs: number) {
    await this.redis.xadd(
      eventStreamKey(sessionId),
      "MAXLEN",
      "~",
      this.streamMaxLen,
      "*",
      "payload",
      JSON.stringify(event)
    );
    await this.redis.pexpire(eventStreamKey(sessionId), ttlMs);
  }

  async readEvents(sessionId: string, afterId: string, count = 100, blockMs?: number) {
    const args: Array<string | number> = [];
    if (blockMs !== undefined) {
      args.push("BLOCK", blockMs);
    }
    args.push("COUNT", count, "STREAMS", eventStreamKey(sessionId), afterId);

    const result = await this.redis.call("XREAD", ...args);
    if (!Array.isArray(result) || result.length === 0) {
      return [];
    }

    return parseStreamEntries(result[0]);
  }
}
