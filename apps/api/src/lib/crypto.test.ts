import { describe, expect, it } from "vitest";

import { decrypt, encrypt } from "./crypto.js";

describe("crypto helpers", () => {
  it("round-trips encrypted values", () => {
    const secret = "this-is-a-long-enough-secret-for-tests";
    const payload = encrypt(secret, "super-secret-value");

    expect(payload).not.toContain("super-secret-value");
    expect(decrypt(secret, payload)).toBe("super-secret-value");
  });
});
