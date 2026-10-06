"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, datasets, db, eq, isNull, notifications, workflows } from "@insight/database";
import type { ActionResult } from "@insight/types";
import { requireWorkspace } from "@/lib/server/workspace";
import { getDatasetProfile } from "@/lib/server/datasets";
import { runWorkflow, scheduleOf } from "@/lib/server/workflows";
import { isValidTimeZone, nextRun } from "@/lib/workflows/schedule";
import { audit } from "@/lib/server/audit";
import { createRateLimiter } from "@/lib/auth/rate-limit";

export type WorkflowState = (ActionResult & { values?: Record<string, string> }) | null;
const runLimiter = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 });

const base = z.object({
  name: z.string().trim().min(2, "Give the workflow a name.").max(120),
  datasetId: z.string().uuid(),
  type: z.enum(["briefing", "weekly_review", "report", "alert"]),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  hour: z.coerce.number().int().min(0).max(23),
  weekday: z.coerce.number().int().min(0).max(6).optional(),
  dayOfMonth: z.coerce.number().int().min(1).max(28).optional(),
  timezone: z.string().refine(isValidTimeZone, "Unknown time zone."),
  alertMode: z.enum(["change", "anomaly", "rows"]).optional(),
  metric: z.enum(["value", "orders", "aov"]).optional(),
  direction: z.enum(["down", "up"]).optional(),
  thresholdPct: z.coerce.number().min(1).max(500).optional(),
  column: z.string().max(120).optional(),
  op: z.enum(["lt", "lte", "gt", "gte"]).optional(),
  value: z.coerce.number().optional(),
  valueColumn: z.string().max(120).optional(),
  labelColumn: z.string().max(120).optional(),
});

export async function createWorkflow(_prev: WorkflowState, form: FormData): Promise<WorkflowState> {
  const { session, workspace } = await requireWorkspace("MEMBER");
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const input = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
  const p = base.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the options.", values };
  const d = p.data;
  if (d.type === "weekly_review") Object.assign(d, { frequency: "weekly" });
  if (d.frequency === "weekly" && d.weekday === undefined) return { ok: false, error: "Choose a day of the week.", values };
  if (d.frequency === "monthly" && d.dayOfMonth === undefined) return { ok: false, error: "Choose a day of the month.", values };
  const [dataset] = await db.select().from(datasets).where(and(eq(datasets.id, d.datasetId), eq(datasets.workspaceId, workspace.id), isNull(datasets.deletedAt))).limit(1);
  if (!dataset) return { ok: false, error: "Dataset not found.", values };

  let config: Record<string, unknown> = {};
  if (d.type === "alert") {
    if (!d.alertMode) return { ok: false, error: "Choose what to alert on.", values };
    if (d.alertMode === "change") config = { mode: "change", metric: d.metric ?? "value", direction: d.direction ?? "down", thresholdPct: d.thresholdPct ?? 10 };
    else if (d.alertMode === "anomaly") config = { mode: "anomaly" };
    else {
      const stored = await getDatasetProfile(workspace.id, dataset.id);
      const cols = new Map(stored?.profile.columns.map((c) => [c.name, c]) ?? []);
      if (!d.column || cols.get(d.column)?.logical_type !== "numeric") return { ok: false, error: "Choose a numeric column to check.", values };
      if (d.valueColumn && cols.get(d.valueColumn)?.logical_type !== "numeric") return { ok: false, error: "The comparison column must be numeric.", values };
      if (!d.valueColumn && d.value === undefined) return { ok: false, error: "Enter a value or choose a column to compare with.", values };
      config = { mode: "rows", column: d.column, op: d.op ?? "lt", value: d.valueColumn ? null : d.value, valueColumn: d.valueColumn ?? null,
        labelColumns: d.labelColumn && cols.has(d.labelColumn) ? [d.labelColumn] : [] };
    }
  }
  const schedule = { frequency: d.frequency, hour: d.hour, weekday: d.frequency === "weekly" ? d.weekday! : null, dayOfMonth: d.frequency === "monthly" ? d.dayOfMonth! : null, timezone: d.timezone };
  const [w] = await db.insert(workflows).values({
    workspaceId: workspace.id, datasetId: dataset.id, createdById: session.user.id, name: d.name, type: d.type, ...schedule, config,
    nextRunAt: nextRun(schedule, new Date()),
  }).returning({ id: workflows.id });
  await audit({ action: "workflow.create", userId: session.user.id, workspaceId: workspace.id, targetType: "workflow", targetId: w.id, metadata: { type: d.type } });
  revalidatePath("/workflows");
  redirect(`/workflows/${w.id}`);
}

async function owned(workspaceId: string, id: unknown) {
  const p = z.string().uuid().safeParse(id);
  if (!p.success) return null;
  const [w] = await db.select().from(workflows).where(and(eq(workflows.id, p.data), eq(workflows.workspaceId, workspaceId), isNull(workflows.deletedAt))).limit(1);
  return w ?? null;
}

export async function runNow(form: FormData) {
  const { session, workspace } = await requireWorkspace("MEMBER");
  const w = await owned(workspace.id, form.get("workflowId"));
  if (!w) redirect("/workflows");
  if (runLimiter(`wfrun:${session.user.id}`).allowed) await runWorkflow(w, "manual", new Date());
  revalidatePath(`/workflows/${w.id}`);
  redirect(`/workflows/${w.id}`);
}

export async function toggleWorkflow(form: FormData) {
  const { session, workspace } = await requireWorkspace("MEMBER");
  const w = await owned(workspace.id, form.get("workflowId"));
  if (!w) redirect("/workflows");
  const enable = !w.enabled;
  await db.update(workflows).set({ enabled: enable, ...(enable ? { consecutiveFailures: 0, nextRunAt: nextRun(scheduleOf(w), new Date()) } : {}) }).where(eq(workflows.id, w.id));
  await audit({ action: enable ? "workflow.resume" : "workflow.pause", userId: session.user.id, workspaceId: workspace.id, targetType: "workflow", targetId: w.id });
  revalidatePath(`/workflows/${w.id}`);
  redirect(`/workflows/${w.id}`);
}

export async function deleteWorkflow(form: FormData) {
  const { session, workspace } = await requireWorkspace("MEMBER");
  const w = await owned(workspace.id, form.get("workflowId"));
  if (!w) redirect("/workflows");
  await db.update(workflows).set({ deletedAt: new Date(), enabled: false }).where(eq(workflows.id, w.id));
  await audit({ action: "workflow.delete", userId: session.user.id, workspaceId: workspace.id, targetType: "workflow", targetId: w.id });
  revalidatePath("/workflows");
  redirect("/workflows?deleted=1");
}

export async function markAllRead() {
  const { session, workspace } = await requireWorkspace();
  await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.userId, session.user.id), eq(notifications.workspaceId, workspace.id), isNull(notifications.readAt)));
  revalidatePath("/", "layout");
}
