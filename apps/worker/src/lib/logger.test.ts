import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.js";

describe("createLogger", () => {
  it("creates a logger with the requested level", () => {
    const logger = createLogger("debug");

    expect(logger.level).toBe("debug");
  });
});
