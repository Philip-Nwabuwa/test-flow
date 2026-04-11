import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AuthoringSessionStore,
  mintAuthoringToken,
  type AuthContext,
  type AuthoringInputSubmitInput,
  type AuthoringSession,
  type AuthoringSessionConnection,
  type AuthoringSessionCreateInput,
  verifyAuthoringToken
} from "@automation/shared";

import { HttpError } from "../lib/http.js";
import { AuthoringRecorderClient, RecorderRequestError } from "../lib/authoring-recorder-client.js";

export class AuthoringSessionService {
  constructor(
    private readonly recorder: AuthoringRecorderClient,
    private readonly store: AuthoringSessionStore,
    private readonly authoringTokenSecret: string,
    private readonly recorderPublicBaseUrl: string,
    private readonly apiPublicBaseUrl: string,
    private readonly tokenTtlSeconds: number
  ) {}

  async create(
    supabase: SupabaseClient,
    auth: AuthContext,
    input: AuthoringSessionCreateInput
  ): Promise<AuthoringSessionConnection> {
    await this.assertFlowAccess(supabase, auth, input.projectId, input.flowId ?? null);

    const session = await this.callRecorder(() =>
      this.recorder.createSession({
        userId: auth.userId,
        projectId: input.projectId,
        flowId: input.flowId ?? null,
        targetUrl: input.targetUrl
      })
    );

    return this.toConnection(session);
  }

  async get(auth: AuthContext, sessionId: string): Promise<AuthoringSessionConnection> {
    const session = await this.requireAccessibleSession(auth, sessionId);
    return this.toConnection(session);
  }

  async submitInput(auth: AuthContext, sessionId: string, input: AuthoringInputSubmitInput) {
    await this.requireAccessibleSession(auth, sessionId);
    await this.callRecorder(() => this.recorder.submitInput(sessionId, input));
    return { ok: true };
  }

  async pause(auth: AuthContext, sessionId: string): Promise<AuthoringSessionConnection> {
    await this.requireAccessibleSession(auth, sessionId);
    const session = await this.callRecorder(() => this.recorder.pause(sessionId));
    return this.toConnection(session);
  }

  async resume(auth: AuthContext, sessionId: string): Promise<AuthoringSessionConnection> {
    await this.requireAccessibleSession(auth, sessionId);
    const session = await this.callRecorder(() => this.recorder.resume(sessionId));
    return this.toConnection(session);
  }

  async end(auth: AuthContext, sessionId: string) {
    await this.requireAccessibleSession(auth, sessionId);
    await this.callRecorder(() => this.recorder.endSession(sessionId));
    return { ok: true };
  }

  async requireStreamAccess(sessionId: string, token: string) {
    const claims = await verifyAuthoringToken(this.authoringTokenSecret, token);
    if (claims.purpose !== "events" || claims.sessionId !== sessionId) {
      throw new HttpError(401, "Invalid authoring stream token");
    }

    const session = await this.store.getSession(sessionId);
    if (!session) {
      throw new HttpError(404, "Authoring session not found");
    }

    if (session.userId !== claims.userId) {
      throw new HttpError(403, "Authoring session access denied");
    }

    return session;
  }

  async readEvents(sessionId: string, afterId: string, count = 100, blockMs?: number) {
    return this.store.readEvents(sessionId, afterId, count, blockMs);
  }

  private async requireAccessibleSession(auth: AuthContext, sessionId: string) {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      throw new HttpError(404, "Authoring session not found");
    }

    if (session.userId !== auth.userId || !auth.projectIds.includes(session.projectId)) {
      throw new HttpError(403, "Authoring session access denied");
    }

    return session;
  }

  private async assertFlowAccess(
    supabase: SupabaseClient,
    auth: AuthContext,
    projectId: string,
    flowId: string | null
  ) {
    if (!auth.projectIds.includes(projectId)) {
      throw new HttpError(403, "Project access denied");
    }

    if (!flowId) {
      return;
    }

    const { data, error } = await supabase
      .from("test_flows")
      .select("id, project_id")
      .eq("id", flowId)
      .eq("project_id", projectId)
      .in("project_id", auth.projectIds)
      .single();

    if (error || !data) {
      throw new HttpError(404, "Flow not found");
    }
  }

  private async toConnection(session: AuthoringSession): Promise<AuthoringSessionConnection> {
    const embedToken = await mintAuthoringToken(
      this.authoringTokenSecret,
      {
        sessionId: session.sessionId,
        userId: session.userId,
        purpose: "embed"
      },
      this.tokenTtlSeconds
    );
    const eventsToken = await mintAuthoringToken(
      this.authoringTokenSecret,
      {
        sessionId: session.sessionId,
        userId: session.userId,
        purpose: "events"
      },
      this.tokenTtlSeconds
    );

    return {
      ...session,
      embedUrl: `${this.recorderPublicBaseUrl}/embed/${encodeURIComponent(session.sessionId)}?token=${encodeURIComponent(embedToken)}`,
      eventsUrl: `${this.apiPublicBaseUrl}/v1/authoring-sessions/${encodeURIComponent(session.sessionId)}/events?token=${encodeURIComponent(eventsToken)}`
    };
  }

  private async callRecorder<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RecorderRequestError) {
        throw new HttpError(502, `Recorder error (${error.statusCode}): ${error.message}`);
      }

      throw error;
    }
  }
}
