import "server-only";
import { auditLogs, db } from "@insight/database";
import { errorFields, logger } from "./logger";

export type AuditAction =
  | "auth.signup"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "workspace.create"
  | "workspace.switch"
  | "workspace.rename"
  | "dataset.upload"
  | "dataset.upload_failed"
  | "dataset.delete"
  | "document.upload"
  | "document.delete"
  | "report.generate"
  | "report.share"
  | "report.unshare"
  | "report.delete"
  | "workflow.create"
  | "workflow.pause"
  | "workflow.resume"
  | "workflow.delete";

export async function audit(entry: {
  action: AuditAction;
  userId?: string | null;
  workspaceId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}) {
  try {
    await db.insert(auditLogs).values({ ...entry, metadata: entry.metadata ?? {} });
  } catch (err) {
    // Audit failures are logged but never break the user's request.
    logger.error("audit.write_failed", { action: entry.action, ...errorFields(err) });
  }
}
