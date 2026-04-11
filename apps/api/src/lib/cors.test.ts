import { describe, expect, it } from "vitest";

import { isAllowedOrigin, parseAllowedOrigins } from "./cors.js";

describe("parseAllowedOrigins", () => {
  it("splits comma-separated origin lists", () => {
    expect(parseAllowedOrigins("https://a.test, https://b.test")).toEqual([
      "https://a.test",
      "https://b.test"
    ]);
  });
});

describe("isAllowedOrigin", () => {
  it("allows requests when the allowlist is empty", () => {
    expect(isAllowedOrigin("https://preview.lovableproject.com", [])).toBe(true);
  });

  it("matches exact origins", () => {
    expect(isAllowedOrigin("https://app.example.com", ["https://app.example.com"])).toBe(true);
    expect(isAllowedOrigin("https://other.example.com", ["https://app.example.com"])).toBe(false);
  });

  it("matches wildcard subdomains", () => {
    expect(
      isAllowedOrigin(
        "https://2f61cdbe-740f-42ac-889c-b9956794c8b7.lovableproject.com",
        ["https://*.lovableproject.com"]
      )
    ).toBe(true);
  });
});
