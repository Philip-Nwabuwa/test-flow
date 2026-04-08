import { describe, expect, it } from "vitest";

import { buildCronPattern, schedulerId } from "./scheduling.js";

describe("buildCronPattern", () => {
  it("builds daily patterns", () => {
    expect(buildCronPattern({ frequency: "daily", minute: 15, hour: 3, everyHours: null })).toBe("15 3 * * *");
  });

  it("builds hourly interval patterns", () => {
    expect(buildCronPattern({ frequency: "hourly", minute: 5, hour: null, everyHours: 2 })).toBe("5 */2 * * *");
  });
});

describe("schedulerId", () => {
  it("creates stable scheduler ids", () => {
    expect(schedulerId("flow-1", "schedule-1")).toBe("schedule:flow-1:schedule-1");
  });
});
