import { randomBytes } from "node:crypto";

export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "workspace";
}

/** Slug with a short random suffix so two "Acme" workspaces never collide. */
export function workspaceSlug(name: string): string {
  return `${slugify(name)}-${randomBytes(3).toString("hex")}`;
}
