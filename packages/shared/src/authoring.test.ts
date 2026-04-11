import { describe, expect, it } from "vitest";

import { mintAuthoringToken, ownerScopeFor, verifyAuthoringToken } from "./authoring.js";

describe("authoring token helpers", () => {
  it("round-trips signed access tokens", async () => {
    const token = await mintAuthoringToken("super-secret-authoring-key-123456", {
      sessionId: "session-1",
      userId: "user-1",
      purpose: "events"
    });

    await expect(verifyAuthoringToken("super-secret-authoring-key-123456", token)).resolves.toEqual({
      sessionId: "session-1",
      userId: "user-1",
      purpose: "events"
    });
  });
});

describe("ownerScopeFor", () => {
  it("prefers flow ids when present", () => {
    expect(ownerScopeFor("project-1", "flow-1")).toBe("flow-1");
    expect(ownerScopeFor("project-1", null)).toBe("project-1");
  });
});
