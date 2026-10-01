import { describe, expect, it } from "vitest";
import { loginSchema, signupSchema, workspaceNameSchema } from "@/lib/validation";
import { slugify, workspaceSlug } from "@/lib/slug";
import { roleAtLeast as roleAtLeastPure } from "@/lib/roles";

describe("signup validation", () => {
  it("normalizes email casing and whitespace", () => {
    const r = signupSchema.parse({ name: " Ana ", email: "  Ana@Example.COM ", password: "longenough1" });
    expect(r.email).toBe("ana@example.com");
    expect(r.name).toBe("Ana");
  });
  it("rejects short passwords and bad emails with readable messages", () => {
    const r = signupSchema.safeParse({ name: "A", email: "nope", password: "short" });
    expect(r.success).toBe(false);
    const msgs = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(msgs).toContain("Enter a valid email address.");
    expect(msgs).toContain("Use at least 10 characters.");
  });
  it("caps password length below bcrypt's 72-byte limit", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x".repeat(65) }).success).toBe(false);
  });
});

describe("workspace names and slugs", () => {
  it("validates length", () => {
    expect(workspaceNameSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(workspaceNameSchema.safeParse({ name: "Acme Retail" }).success).toBe(true);
  });
  it("slugifies accents and symbols", () => {
    expect(slugify("Café & Co. — Ventas!")).toBe("cafe-co-ventas");
    expect(slugify("!!!")).toBe("workspace");
  });
  it("adds a random suffix so identical names never collide", () => {
    expect(workspaceSlug("Acme")).toMatch(/^acme-[0-9a-f]{6}$/);
    expect(workspaceSlug("Acme")).not.toBe(workspaceSlug("Acme"));
  });
});

describe("role hierarchy", () => {
  it("orders roles owner > admin > member > viewer", () => {
    expect(roleAtLeastPure("OWNER", "ADMIN")).toBe(true);
    expect(roleAtLeastPure("MEMBER", "ADMIN")).toBe(false);
    expect(roleAtLeastPure("VIEWER", "VIEWER")).toBe(true);
  });
});
