import "server-only";
import { createHash } from "node:crypto";
import { and, datasets, db, eq, isNull, reports, users } from "@insight/database";
import type { ReportContent } from "./reports";

export async function getReport(workspaceId: string, id: string) {
  const [row] = await db.select({ report: reports, datasetName: datasets.name, author: users.name }).from(reports)
    .innerJoin(datasets, eq(datasets.id, reports.datasetId)).leftJoin(users, eq(users.id, reports.createdById))
    .where(and(eq(reports.id, id), eq(reports.workspaceId, workspaceId), isNull(reports.deletedAt))).limit(1);
  return row ?? null;
}

/** A shared report by its link token. Only the token's hash is stored; nothing else about the
 * workspace is exposed. Revoked or deleted reports aren't found. */
export async function getSharedReport(token: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const [row] = await db.select({ report: reports, author: users.name }).from(reports).leftJoin(users, eq(users.id, reports.createdById))
    .where(and(eq(reports.shareTokenHash, hash), isNull(reports.deletedAt), eq(reports.status, "ready"))).limit(1);
  return row ? { ...row, content: row.report.content as ReportContent } : null;
}
