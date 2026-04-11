import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import { access } from "node:fs/promises";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import {
  AuthoringSessionStore,
  type AuthoringEvent,
  type AuthoringInputSubmitInput,
  type AuthoringSession
} from "@automation/shared";

import { buildRecorderInitScript } from "../lib/recorder-script.js";
import {
  buildClickSuggestion,
  buildCredentialHint,
  buildInputRequest,
  buildInputSuggestion,
  buildSelectSuggestion,
  type DomCaptureEvent
} from "../lib/selectors.js";

interface ActiveSession {
  session: AuthoringSession;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  xvfb: ChildProcessWithoutNullStreams;
  x11vnc: ChildProcessWithoutNullStreams;
  vncPort: number;
  display: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  lastRequestedInput: ReturnType<typeof buildInputRequest> | null;
  seenInitialNavigation: boolean;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findOpenPort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a TCP port"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

let nextDisplay = 90;

async function findOpenDisplay() {
  for (let attempts = 0; attempts < 200; attempts += 1) {
    const candidate = nextDisplay++;
    try {
      await access(`/tmp/.X11-unix/X${candidate}`);
    } catch {
      return candidate;
    }
  }

  throw new Error("Unable to allocate an X11 display for the recorder");
}

async function waitForPort(port: number, timeoutMs = 5000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const isOpen = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (isOpen) {
      return;
    }

    await delay(150);
  }

  throw new Error(`Port ${port} did not become ready in time`);
}

function terminateProcess(process: ChildProcessWithoutNullStreams | undefined) {
  if (!process || process.killed) {
    return;
  }

  process.kill("SIGTERM");
}

export class SessionManager {
  private readonly sessions = new Map<string, ActiveSession>();

  constructor(
    private readonly store: AuthoringSessionStore,
    private readonly ttlMs: number,
    private readonly viewportWidth: number,
    private readonly viewportHeight: number,
    private readonly logger: { info: (value: unknown, message?: string) => void; error: (value: unknown, message?: string) => void }
  ) {}

  async createSession(input: {
    sessionId: string;
    userId: string;
    projectId: string;
    flowId: string | null;
    targetUrl: string;
  }) {
    const existingId = await this.store.getOwnerSession(input.userId, input.projectId, input.flowId);
    if (existingId) {
      await this.endSession(existingId, "superseded");
    }

    const now = new Date().toISOString();
    const session: AuthoringSession = {
      sessionId: input.sessionId,
      userId: input.userId,
      projectId: input.projectId,
      flowId: input.flowId,
      targetUrl: input.targetUrl,
      currentUrl: null,
      status: "starting",
      capturePaused: false,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString()
    };

    await this.store.saveSession(session, this.ttlMs);
    await this.emitEvent(session.sessionId, {
      id: "",
      type: "session.loading",
      sessionId: session.sessionId,
      createdAt: now,
      data: {
        targetUrl: session.targetUrl
      }
    });

    let xvfb: ChildProcessWithoutNullStreams | undefined;
    let x11vnc: ChildProcessWithoutNullStreams | undefined;
    let browser: Browser | undefined;

    try {
      const display = await findOpenDisplay();
      const vncPort = await findOpenPort();
      xvfb = spawn("Xvfb", [`:${display}`, "-screen", "0", `${this.viewportWidth}x${this.viewportHeight}x24`, "-ac"]);
      await delay(250);

      x11vnc = spawn("x11vnc", [
        "-display",
        `:${display}`,
        "-forever",
        "-shared",
        "-rfbport",
        String(vncPort),
        "-nopw",
        "-localhost"
      ]);
      await waitForPort(vncPort);

      browser = await chromium.launch({
        headless: false,
        env: {
          ...process.env,
          DISPLAY: `:${display}`
        },
        args: [
          "--no-sandbox",
          `--window-size=${this.viewportWidth},${this.viewportHeight}`
        ]
      });

      const context = await browser.newContext({
        viewport: {
          width: this.viewportWidth,
          height: this.viewportHeight
        }
      });

      await context.exposeBinding("__codexAuthoringEmit", async (_source, payload) => {
        await this.handleDomEvent(input.sessionId, payload as DomCaptureEvent);
      });
      await context.addInitScript({ content: buildRecorderInitScript() });

      const page = await context.newPage();
      const activeSession: ActiveSession = {
        session,
        browser,
        context,
        page,
        xvfb,
        x11vnc,
        vncPort,
        display,
        lastRequestedInput: null,
        seenInitialNavigation: false
      };

      this.sessions.set(session.sessionId, activeSession);
      this.attachPageListeners(activeSession, page);
      context.on("page", (nextPage) => {
        activeSession.page = nextPage;
        this.attachPageListeners(activeSession, nextPage);
      });

      await page.goto(input.targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

      await this.updateSession(activeSession, {
        currentUrl: page.url(),
        status: "ready",
        capturePaused: false
      });
      await this.emitEvent(session.sessionId, {
        id: "",
        type: "session.ready",
        sessionId: session.sessionId,
        createdAt: new Date().toISOString(),
        data: {
          currentUrl: page.url(),
          expiresAt: activeSession.session.expiresAt
        }
      });

      this.armIdleTimer(activeSession);
      return activeSession.session;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start authoring session";
      this.logger.error(
        {
          error,
          sessionId: session.sessionId,
          targetUrl: input.targetUrl
        },
        "Failed to start authoring session"
      );
      await this.store.appendEvent(session.sessionId, {
        id: "",
        type: "session.error",
        sessionId: session.sessionId,
        createdAt: new Date().toISOString(),
        data: { message }
      }, this.ttlMs);
      await this.store.deleteSession({
        sessionId: session.sessionId,
        userId: session.userId,
        projectId: session.projectId,
        flowId: session.flowId
      });
      terminateProcess(x11vnc);
      terminateProcess(xvfb);
      if (browser) {
        await browser.close().catch(() => undefined);
      }
      throw error;
    }
  }

  async getSession(sessionId: string) {
    const active = this.sessions.get(sessionId);
    if (active) {
      return active.session;
    }

    return this.store.getSession(sessionId);
  }

  getSessionVncPort(sessionId: string) {
    return this.sessions.get(sessionId)?.vncPort ?? null;
  }

  async pause(sessionId: string) {
    const runtime = this.requireActiveSession(sessionId);
    await this.updateSession(runtime, {
      status: "paused",
      capturePaused: true
    });
    return runtime.session;
  }

  async resume(sessionId: string) {
    const runtime = this.requireActiveSession(sessionId);
    await this.updateSession(runtime, {
      status: "ready",
      capturePaused: false
    });
    return runtime.session;
  }

  async submitInput(sessionId: string, input: AuthoringInputSubmitInput) {
    const runtime = this.requireActiveSession(sessionId);
    const targetSelector = input.selector ?? runtime.lastRequestedInput?.selector;
    if (!targetSelector) {
      throw new Error("No target input selector is available for this session");
    }

    await runtime.page.locator(targetSelector).first().fill(input.value);
    await this.touch(runtime);

    const createdAt = new Date().toISOString();
    const suggestion = buildInputSuggestion(
      targetSelector,
      input.semanticLabel,
      runtime.page.url(),
      input.value,
      createdAt
    );
    await this.emitEvent(sessionId, {
      id: "",
      type: "step.suggested",
      sessionId,
      createdAt,
      data: suggestion
    });

    const credentialHint = buildCredentialHint({
      selector: targetSelector,
      semanticLabel: input.semanticLabel,
      inputType: input.inputType ?? runtime.lastRequestedInput?.inputType ?? null
    });
    if (credentialHint) {
      await this.emitEvent(sessionId, {
        id: "",
        type: "credential.hint",
        sessionId,
        createdAt,
        data: credentialHint
      });
    }

    runtime.lastRequestedInput = null;
    return { ok: true } as const;
  }

  async endSession(sessionId: string, reason = "ended") {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) {
      const stored = await this.store.getSession(sessionId);
      if (stored) {
        await this.store.clearOwnerSession(stored);
        await this.store.deleteSessionData(stored.sessionId);
      }
      return;
    }

    this.sessions.delete(sessionId);
    clearTimeout(runtime.idleTimer);
    await this.updateSession(runtime, {
      status: "ended",
      capturePaused: true
    }, 60000, false);
    await this.store.clearOwnerSession(runtime.session);
    await this.emitEvent(sessionId, {
      id: "",
      type: "session.ended",
      sessionId,
      createdAt: new Date().toISOString(),
      data: { reason }
    }, 60000);

    await runtime.context.close().catch(() => undefined);
    await runtime.browser.close().catch(() => undefined);
    terminateProcess(runtime.x11vnc);
    terminateProcess(runtime.xvfb);

    setTimeout(() => {
      void this.store.deleteSessionData(sessionId);
    }, 60000).unref();
  }

  private attachPageListeners(runtime: ActiveSession, page: Page) {
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) {
        return;
      }

      const createdAt = new Date().toISOString();
      if (!runtime.seenInitialNavigation) {
        runtime.seenInitialNavigation = true;
        return;
      }

      void this.updateSession(runtime, { currentUrl: frame.url() }).catch((error) => {
        this.logger.error({ error, sessionId: runtime.session.sessionId }, "Failed to update current URL");
      });
      void this.emitEvent(runtime.session.sessionId, {
        id: "",
        type: "page.navigated",
        sessionId: runtime.session.sessionId,
        createdAt,
        data: {
          url: frame.url()
        }
      }).catch((error) => {
        this.logger.error({ error, sessionId: runtime.session.sessionId }, "Failed to emit navigation event");
      });
    });
  }

  private async handleDomEvent(sessionId: string, event: DomCaptureEvent) {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) {
      return;
    }

    await this.touch(runtime);

    if (runtime.session.capturePaused) {
      return;
    }

    const createdAt = new Date().toISOString();

    if (event.kind === "input-request") {
      const inputRequest = buildInputRequest(event);
      runtime.lastRequestedInput = inputRequest;
      await this.emitEvent(sessionId, {
        id: "",
        type: "input.requested",
        sessionId,
        createdAt,
        data: inputRequest
      });

      const credentialHint = buildCredentialHint(inputRequest);
      if (credentialHint) {
        await this.emitEvent(sessionId, {
          id: "",
          type: "credential.hint",
          sessionId,
          createdAt,
          data: credentialHint
        });
      }
      return;
    }

    if (event.kind === "select-change") {
      await this.emitEvent(sessionId, {
        id: "",
        type: "step.suggested",
        sessionId,
        createdAt,
        data: buildSelectSuggestion(event, createdAt)
      });
      return;
    }

    await this.emitEvent(sessionId, {
      id: "",
      type: "step.suggested",
      sessionId,
      createdAt,
      data: buildClickSuggestion(event, createdAt)
    });
  }

  private requireActiveSession(sessionId: string) {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) {
      throw new Error("Authoring session is no longer active");
    }

    return runtime;
  }

  private async touch(runtime: ActiveSession) {
    const now = new Date();
    runtime.session = {
      ...runtime.session,
      lastActivityAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString()
    };
    await this.store.saveSession(runtime.session, this.ttlMs);
    this.armIdleTimer(runtime);
  }

  private async updateSession(
    runtime: ActiveSession,
    patch: Partial<Pick<AuthoringSession, "status" | "currentUrl" | "capturePaused">>,
    ttlMs = this.ttlMs,
    writeOwner = true
  ) {
    const now = new Date();
    runtime.session = {
      ...runtime.session,
      ...patch,
      updatedAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString()
    };
    await this.store.saveSession(runtime.session, ttlMs, writeOwner);
    if (ttlMs === this.ttlMs) {
      this.armIdleTimer(runtime);
    }
  }

  private async emitEvent(sessionId: string, event: AuthoringEvent, ttlMs = this.ttlMs) {
    await this.store.appendEvent(sessionId, event, ttlMs);
  }

  private armIdleTimer(runtime: ActiveSession) {
    clearTimeout(runtime.idleTimer);
    runtime.idleTimer = setTimeout(() => {
      void this.endSession(runtime.session.sessionId, "expired");
    }, this.ttlMs);
    runtime.idleTimer.unref();
  }
}
