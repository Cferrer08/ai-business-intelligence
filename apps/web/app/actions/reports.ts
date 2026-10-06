"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, datasets, db, eq, isNull, reports } from "@insight/database";
import type { ActionResult } from "@insight/types";
import { requireWorkspace } from "@/lib/server/workspace";
import { getDatasetProfile } from "@/lib/server/datasets";
import { buildReport } from "@/lib/server/reports";
import { EngineUnavailable } from "@/lib/server/engine";
import { audit } from "@/lib/server/audit";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { errorFields, logger } from "@/lib/server/logger";

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });
export type ReportState = ActionResult | null;

export async function generateReport(_prev: ReportState, form: FormData): Promise<ReportState> {
  const { session, workspace } = await requireWorkspace("MEMBER");
  const datasetId = z.string().uuid().safeParse(form.get("datasetId"));
  if (!datasetId.success) return { ok: false, error: "Choose a dataset." };
  if (!limiter(`report:${session.user.id}`).allowed) return { ok: false, error: "That's a lot of reports in a short time. Wait a few minutes." };
  const [dataset] = await db.select().from(datasets)
    .where(and(eq(datasets.id, datasetId.data), eq(datasets.workspaceId, workspace.id), isNull(datasets.deletedAt), eq(datasets.status, "ready"))).limit(1);
  if (!dataset) return { ok: false, error: "Dataset not found." };
  const stored = await getDatasetProfile(workspace.id, dataset.id);
  if (!stored) return { ok: false, error: "This dataset has no profile yet." };

  const [row] = await db.insert(reports).values({
    workspaceId: workspace.id, datasetId: dataset.id, createdById: session.user.id, title: `${dataset.name} business report`, status: "generating",
  }).returning({ id: reports.id });
  const started = Date.now();
  try {
    const content = await buildReport({ workspaceId: workspace.id, userId: session.user.id, datasetId: dataset.id, datasetName: dataset.name, profile: stored.profile });
    const title = `${dataset.name} business report${content.periodLabel ? `, ${content.periodLabel}` : ""}`.slice(0, 200);
    await db.update(reports).set({ status: "ready", content, title, durationMs: Date.now() - started })
      .where(and(eq(reports.id, row.id), eq(reports.workspaceId, workspace.id)));
    await audit({ action: "report.generate", userId: session.user.id, workspaceId: workspace.id, targetType: "report", targetId: row.id });
  } catch (err) {
    const message = err instanceof EngineUnavailable ? "The data engine isn't reachable right now. Check that it's running, then try again."
      : "Something went wrong while generating the report. Your data was not modified.";
    if (!(err instanceof EngineUnavailable)) logger.error("report.failed", { reportId: row.id, ...errorFields(err) });
    await db.update(reports).set({ status: "failed", errorMessage: message, durationMs: Date.now() - started }).where(eq(reports.id, row.id));
    return { ok: false, error: message };
  }
  revalidatePath("/reports");
  redirect(`/reports/${row.id}`);
}

export async function shareReport(reportId: string): Promise<ActionResult<{ url: string }>> {
  const { session, workspace } = await requireWorkspace("MEMBER");
  const id = z.string().uuid().safeParse(reportId);
  if (!id.success) return { ok: false, error: "Report not found." };
  const token = randomBytes(32).toString("base64url");
  const [r] = await db.update(reports).set({ shareTokenHash: createHash("sha256").update(token).digest("hex"), sharedAt: new Date() })
    .where(and(eq(reports.id, id.data), eq(reports.workspaceId, workspace.id), isNull(reports.deletedAt), eq(reports.status, "ready")))
    .returning({ id: reports.id });
  if (!r) return { ok: false, error: "Report not found." };
  await audit({ action: "report.share", userId: session.user.id, workspaceId: workspace.id, targetType: "report", targetId: r.id });
  revalidatePath(`/reports/${r.id}`);
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return { ok: true, data: { url: `${base}/r/${token}` } };
}

export async function unshareReport(form: FormData) {
  const { session, workspace } = await requireWorkspace("MEMBER");
  const id = z.string().uuid().safeParse(form.get("reportId"));
  if (!id.success) return;
  await db.update(reports).set({ shareTokenHash: null, sharedAt: null }).where(and(eq(reports.id, id.data), eq(reports.workspaceId, workspace.id)));
  await audit({ action: "report.unshare", userId: session.user.id, workspaceId: workspace.id, targetType: "report", targetId: id.data });
  revalidatePath(`/reports/${id.data}`);
}

export async function deleteReport(form: FormData) {
  const { session, workspace } = await requireWorkspace("MEMBER");
  const id = z.string().uuid().safeParse(form.get("reportId"));
  if (!id.success) redirect("/reports");
  await db.update(reports).set({ deletedAt: new Date(), shareTokenHash: null }).where(and(eq(reports.id, id.data), eq(reports.workspaceId, workspace.id)));
  await audit({ action: "report.delete", userId: session.user.id, workspaceId: workspace.id, targetType: "report", targetId: id.data });
  revalidatePath("/reports");
  redirect("/reports?deleted=1");
}
