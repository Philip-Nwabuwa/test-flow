import { describe, expect, it, vi } from "vitest";

import { createRateLimitMiddleware } from "./rate-limit.js";

describe("createRateLimitMiddleware", () => {
  it("allows requests below the threshold and blocks after the limit", () => {
    const middleware = createRateLimitMiddleware(60_000, 2);
    const headers = new Map<string, string>();
    const req = {
      ip: "127.0.0.1",
      header: vi.fn()
    } as any;
    const res = {
      setHeader: (key: string, value: string) => headers.set(key, value)
    } as any;

    const firstNext = vi.fn();
    middleware(req, res, firstNext);
    expect(firstNext).toHaveBeenCalledWith();
    expect(headers.get("x-ratelimit-remaining")).toBe("1");

    const secondNext = vi.fn();
    middleware(req, res, secondNext);
    expect(secondNext).toHaveBeenCalledWith();
    expect(headers.get("x-ratelimit-remaining")).toBe("0");

    const thirdNext = vi.fn();
    middleware(req, res, thirdNext);
    expect(thirdNext.mock.calls[0][0].statusCode).toBe(429);
  });
});
