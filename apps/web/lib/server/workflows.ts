import "server-only";
import { createHash } from "node:crypto";
import { and, datasets, db, eq, isNull, notifications, reports, sql, workflowExecutions, workflows, workspaceMembers } from "@insight/database";
import { AnalysisExecutionError, summarizeReport, type EngineResult } from "@insight/ai";
import { getDatasetProfile } from "./datasets";
import { alertRows, briefingData, EngineRejected, EngineUnavailable } from "./engine";
import { buildReport } from "./reports";
import { getLlm, recordAiUsage } from "./ai";
import { nextRun, type Schedule } from "@/lib/workflows/schedule";
import { errorFields, logger } from "./logger";

export type Workflow = typeof workflows.$inferSelect;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export interface AlertConfig {
  mode: "change" | "anomaly" | "rows";
  metric?: "value" | "orders" | "aov";
  direction?: "down" | "up";
  thresholdPct?: number;
  column?: string; op?: "lt" | "lte" | "gt" | "gte"; value?: number | null; valueColumn?: string | null; labelColumns?: string[];
}

export const unitFor = (f: Workflow["frequency"]) => (f === "daily" ? "day" : f === "weekly" ? "week" : "month") as "day" | "week" | "month";
export const scheduleOf = (w: Pick<Workflow, "frequency" | "hour" | "weekday" | "dayOfMonth" | "timezone">): Schedule =>
  ({ frequency: w.frequency, hour: w.hour, weekday: w.weekday, dayOfMonth: w.dayOfMonth, timezone: w.timezone });

async function notifyMembers(workspaceId: string, n: { kind: string; title: string; body: string; link: string }) {
  const members = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
  if (members.length) await db.insert(notifications).values(members.map((m) => ({ workspaceId, userId: m.userId, ...n, title: n.title.slice(0, 200), body: n.body.slice(0, 2000) })));
}

const plain = (text: string, facts: { id: string; display: string }[]) => text.replace(/\{(f\d+)\}/g, (_, id) => facts.find((f) => f.id === id)?.display ?? "");

/** Run one occurrence. Returns null if another tick already ran this occurrence. */
export async function runWorkflow(w: Workflow, trigger: "schedule" | "manual", scheduledFor: Date) {
  const [exec] = await db.insert(workflowExecutions).values({ workflowId: w.id, workspaceId: w.workspaceId, trigger, scheduledFor })
    .onConflictDoNothing().returning();
  if (!exec) return null;
  const started = Date.now();
  const link = `/workflows/${w.id}`;
  try {
    const [dataset] = await db.select().from(datasets).where(and(eq(datasets.id, w.datasetId), eq(datasets.workspaceId, w.workspaceId), isNull(datasets.deletedAt))).limit(1);
    if (!dataset || dataset.status !== "ready") throw new AnalysisExecutionError("dataset_missing", "The dataset this workflow uses was deleted or isn't ready.");
    const stored = await getDatasetProfile(w.workspaceId, dataset.id);
    if (!stored) throw new AnalysisExecutionError("dataset_missing", "The dataset has no profile.");
    const columns = stored.profile.columns.map((c) => ({ name: c.name, logical_type: c.logical_type, role: c.role.role, concept: c.role.concept }));
    const today = new Date().toISOString().slice(0, 10);
    const userId = w.createdById ?? "";
    const usage = (purpose: string, u: any, ok: boolean, code?: string) =>
      recordAiUsage({ workspaceId: w.workspaceId, userId, analysisRequestId: null, purpose, model: getLlm()?.model ?? "none", usage: u, succeeded: ok, errorCode: code });

    let output: Record<string, unknown> = {};
    let reportId: string | null = null;
    let notification: { kind: string; title: string; body: string; link: string } | null = null;

    const briefing = async (unit: "day" | "week" | "month") => {
      const b = await briefingData(w.workspaceId, dataset.id, { unit, columns, today });
      const llm = userId ? getLlm() : null;
      const summary = await summarizeReport([{ key: "briefing", title: "Briefing", type: "briefing", facts: b.facts, notes: b.notes, labels: b.labels }], llm, usage);
      return { briefing: b, summary };
    };

    if (w.type === "briefing" || w.type === "weekly_review") {
      const { briefing: b, summary } = await briefing(w.type === "weekly_review" ? "week" : unitFor(w.frequency));
      output = { briefing: b, summary };
      const lines = summary.executive_summary.map((t) => plain(t, b.facts));
      notification = { kind: "briefing", title: `${w.name}: ${(b as any).period.current}`, body: [...lines, ...b.notes].join("\n"), link };
    }
    if (w.type === "weekly_review" || w.type === "report") {
      const content = await buildReport({ workspaceId: w.workspaceId, userId, datasetId: dataset.id, datasetName: dataset.name, profile: stored.profile });
      const title = `${dataset.name} business report${content.periodLabel ? `, ${content.periodLabel}` : ""}`.slice(0, 200);
      const [r] = await db.insert(reports).values({ workspaceId: w.workspaceId, datasetId: dataset.id, createdById: w.createdById, title, status: "ready", content }).returning({ id: reports.id });
      reportId = r.id;
      output = { ...output, reportId: r.id, reportTitle: title };
      if (w.type === "report") notification = { kind: "report", title: `${w.name}: report ready`, body: title, link: `/reports/${r.id}` };
      else if (notification) notification.body += `\nFull report: ${title}`;
    }
    if (w.type === "alert") {
      const cfg = w.config as AlertConfig;
      let triggered = false;
      let detail = "";
      let key = "";
      if (cfg.mode === "rows") {
        const r = await alertRows(w.workspaceId, dataset.id, { column: cfg.column, op: cfg.op, value: cfg.value ?? null, value_column: cfg.valueColumn ?? null, label_columns: cfg.labelColumns ?? [], columns });
        triggered = r.matches > 0;
        detail = `${r.matches} row${r.matches === 1 ? "" : "s"} with ${r.condition}`;
        key = createHash("sha256").update(JSON.stringify(r.rows)).digest("hex");
        output = { alert: r, triggered, detail };
      } else {
        const b = await briefingData(w.workspaceId, dataset.id, { unit: unitFor(w.frequency), columns, today });
        const bb = b as any;
        key = String(bb.period.current);
        if (cfg.mode === "anomaly") {
          triggered = bb.unusual.length > 0;
          detail = triggered ? `${bb.unusual.length} unusual day(s) in ${bb.period.current}: ${bb.unusual.map((u: any) => u.reason).join(" ")}` : `Nothing unusual in ${bb.period.current}.`;
        } else {
          const k = bb.kpis.find((x: any) => x.key === (cfg.metric ?? "value"));
          const ch: number | null = k?.change_pct ?? null;
          const limit = cfg.thresholdPct ?? 10;
          triggered = ch != null && (cfg.direction === "up" ? ch >= limit : ch <= -limit);
          detail = ch == null ? "No comparison period in the data." : `${k.label} ${ch < 0 ? "fell" : "rose"} ${Math.abs(ch).toFixed(1)}% in ${bb.period.current} vs ${bb.period.baseline} (alert at ${cfg.direction === "up" ? "+" : "−"}${limit}%).`;
        }
        output = { briefing: b, triggered, detail };
      }
      // Don't repeat an alert for the same data: only notify when the result changed.
      const [prev] = await db.select({ output: workflowExecutions.output }).from(workflowExecutions)
        .where(and(eq(workflowExecutions.workflowId, w.id), eq(workflowExecutions.status, "succeeded"))).orderBy(sql`started_at desc`).limit(1);
      const prevOut = prev?.output as { triggered?: boolean; key?: string } | undefined;
      const repeat = prevOut?.triggered && prevOut.key === key;
      output = { ...output, key, notified: triggered && !repeat };
      if (triggered && !repeat) notification = { kind: "alert", title: `Alert: ${w.name}`, body: detail, link };
    }

    await db.update(workflowExecutions).set({ status: "succeeded", output, reportId, finishedAt: new Date(), durationMs: Date.now() - started }).where(eq(workflowExecutions.id, exec.id));
    await db.update(workflows).set({ lastRunAt: new Date(), lastStatus: "succeeded", consecutiveFailures: 0, lockedUntil: null }).where(eq(workflows.id, w.id));
    if (notification) await notifyMembers(w.workspaceId, notification);
    logger.info("workflow.succeeded", { workflowId: w.id, type: w.type, trigger, ms: Date.now() - started });
    return { status: "succeeded" as const, executionId: exec.id };
  } catch (err) {
    const message = err instanceof AnalysisExecutionError || err instanceof EngineRejected ? err.message
      : err instanceof EngineUnavailable ? "The data engine wasn't reachable." : "Something went wrong while running this workflow.";
    if (!(err instanceof AnalysisExecutionError || err instanceof EngineRejected || err instanceof EngineUnavailable)) logger.error("workflow.failed", { workflowId: w.id, ...errorFields(err) });
    const failures = w.consecutiveFailures + 1;
    const pause = failures >= MAX_FAILURES;
    await db.update(workflowExecutions).set({ status: "failed", errorMessage: message.slice(0, 500), finishedAt: new Date(), durationMs: Date.now() - started }).where(eq(workflowExecutions.id, exec.id));
    await db.update(workflows).set({ lastRunAt: new Date(), lastStatus: "failed", consecutiveFailures: failures, lockedUntil: null, ...(pause ? { enabled: false } : {}) }).where(eq(workflows.id, w.id));
    await notifyMembers(w.workspaceId, pause
      ? { kind: "workflow_paused", title: `Paused: ${w.name}`, body: `It failed ${failures} times in a row and has been paused. Last error: ${message}`, link }
      : { kind: "workflow_failed", title: `Failed: ${w.name}`, body: message, link });
    return { status: "failed" as const, executionId: exec.id, message };
  }
}

/**
 * Claim due workflows with row locks (FOR UPDATE SKIP LOCKED), so concurrent ticks never take
 * the same one, and move each to its next run before executing. Missed runs (server off) run
 * once, then continue from now.
 */
export async function claimDue(limit = 5): Promise<{ workflow: Workflow; scheduledFor: Date }[]> {
  return db.transaction(async (tx) => {
    const due = await tx.execute(sql`
      select id from workflows
      where enabled and deleted_at is null and next_run_at <= now() and (locked_until is null or locked_until < now())
      order by next_run_at limit ${limit} for update skip locked`);
    const claimed: { workflow: Workflow; scheduledFor: Date }[] = [];
    for (const { id } of due.rows as { id: string }[]) {
      const [w] = await tx.select().from(workflows).where(eq(workflows.id, id));
      const now = new Date();
      const next = nextRun(scheduleOf(w), now);
      await tx.update(workflows).set({ nextRunAt: next, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60000) }).where(eq(workflows.id, id));
      claimed.push({ workflow: w, scheduledFor: w.nextRunAt });
    }
    return claimed;
  });
}

export async function tick() {
  const claimed = await claimDue();
  const results = [];
  for (const c of claimed) results.push({ workflowId: c.workflow.id, ...(await runWorkflow(c.workflow, "schedule", c.scheduledFor)) });
  return results;
}
