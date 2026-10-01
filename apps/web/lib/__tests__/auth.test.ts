import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/tokens";
import { createRateLimiter } from "@/lib/auth/rate-limit";

describe("passwords", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong password!!", hash)).toBe(false);
  });

  it("dummy hash is a valid bcrypt hash that matches nothing realistic", async () => {
    expect(DUMMY_HASH).toMatch(/^\$2[aby]\$12\$/);
    expect(await verifyPassword("anything at all", DUMMY_HASH)).toBe(false);
  });
});

describe("session tokens", () => {
  it("are long, unique and stored only as a SHA-256 hex digest", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashSessionToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(a)).toBe(hashSessionToken(a));
  });
});

describe("rate limiter", () => {
  it("blocks after the limit and resets after the window", () => {
    let t = 0;
    const check = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect(check("k").allowed).toBe(true);
    expect(check("k").allowed).toBe(true);
    const blocked = check("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
    expect(check("other").allowed).toBe(true);
    t = 1000;
    expect(check("k").allowed).toBe(true);
  });
});
