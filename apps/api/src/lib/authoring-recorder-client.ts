import type {
  AuthoringInputSubmitInput,
  AuthoringSession,
  AuthoringSessionCreateInput
} from "@automation/shared";

interface RecorderCreatePayload extends AuthoringSessionCreateInput {
  userId: string;
}

export class RecorderRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly responseBody: string
  ) {
    super(message);
  }
}

export class AuthoringRecorderClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  createSession(payload: RecorderCreatePayload) {
    return this.call<AuthoringSession>("/internal/sessions", {
      method: "POST",
      body: payload
    });
  }

  getSession(sessionId: string) {
    return this.call<AuthoringSession>(`/internal/sessions/${sessionId}`, {
      method: "GET"
    });
  }

  submitInput(sessionId: string, payload: AuthoringInputSubmitInput) {
    return this.call<{ ok: true }>(`/internal/sessions/${sessionId}/input`, {
      method: "POST",
      body: payload
    });
  }

  pause(sessionId: string) {
    return this.call<AuthoringSession>(`/internal/sessions/${sessionId}/pause`, {
      method: "POST"
    });
  }

  resume(sessionId: string) {
    return this.call<AuthoringSession>(`/internal/sessions/${sessionId}/resume`, {
      method: "POST"
    });
  }

  endSession(sessionId: string) {
    return this.call<{ ok: true }>(`/internal/sessions/${sessionId}`, {
      method: "DELETE"
    });
  }

  private async call<T>(
    path: string,
    input: {
      method: "GET" | "POST" | "DELETE";
      body?: unknown;
    }
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: input.method,
        headers: {
          "Content-Type": "application/json",
          "x-recorder-key": this.apiKey
        },
        body: input.body ? JSON.stringify(input.body) : undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recorder is unavailable";
      throw new RecorderRequestError(503, `Recorder connection failed: ${message}`, message);
    }

    if (!response.ok) {
      const text = await response.text();
      let message = `Recorder request failed (${response.status})`;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
          message = parsed.error;
        } else if (text.trim().length > 0) {
          message = text;
        }
      } catch {
        if (text.trim().length > 0) {
          message = text;
        }
      }

      throw new RecorderRequestError(response.status, message, text);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}
