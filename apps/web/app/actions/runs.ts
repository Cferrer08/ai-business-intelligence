"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { and, datasets, db, eq, isNull } from "@insight/database";
import { AnalysisExecutionError } from "@insight/ai";
import type { ActionResult } from "@insight/types";
import { requireWorkspace } from "@/lib/server/workspace";
import { getDatasetProfile } from "@/lib/server/datasets";
import { analyzeDataset, EngineRejected, EngineUnavailable } from "@/lib/server/engine";
import { PAGE_OF, saveRun, type RunKind } from "@/lib/server/runs";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { errorFields, logger } from "@/lib/server/logger";

export type RunState = (ActionResult & { values?: Record<string, string> }) | null;

const limiter = createRateLimiter({ limit: 40, windowMs: 10 * 60 * 1000 });
const ROWS = "__rows";
const col = z.string().min(1).max(120);
const grain = z.enum(["auto", "day", "week", "month", "quarter"]);

const forms = {
  forecast: z.object({ metric: col, date: col, grain, horizon: z.coerce.number().int().min(1).max(104) }),
  anomalies: z.object({ scope: z.enum(["time", "groups", "records"]), metric: col.optional(), date: col.optional(), grain: grain.default("auto"), dimension: col.optional(), sensitivity: z.enum(["low", "normal", "high"]) }),
  correlation: z.object({ grain: z.enum(["none", "day", "week", "month"]) }),
  segmentation: z.object({}),
  trend: z.object({ metric: col, date: col, grain }),
};

export async function runModel(kind: RunKind, _prev: RunState, form: FormData): Promise<RunState> {
  const { session, workspace } = await requireWorkspace("MEMBER");
  const values = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v).slice(0, 200)]));
  // Empty optional fields ("All numeric columns") mean "not set".
  const input = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
  const datasetId = z.string().uuid().safeParse(form.get("datasetId"));
  if (!datasetId.success) return { ok: false, error: "Choose a dataset.", values };
  const parsed = forms[kind].safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the options and try again.", values };
  if (!limiter(`run:${session.user.id}`).allowed) return { ok: false, error: "That's a lot of runs in a short time. Wait a few minutes.", values };

  const [dataset] = await db.select().from(datasets)
    .where(and(eq(datasets.id, datasetId.data), eq(datasets.workspaceId, workspace.id), isNull(datasets.deletedAt), eq(datasets.status, "ready"))).limit(1);
  if (!dataset) return { ok: false, error: "Dataset not found.", values };
  const stored = await getDatasetProfile(workspace.id, dataset.id);
  if (!stored) return { ok: false, error: "This dataset has no profile yet.", values };
  const cols = new Map(stored.profile.columns.map((c) => [c.name, c]));
  const known = (name: string | undefined) => (name && (name === ROWS || cols.has(name)) ? name : undefined);
  const metric = (name: string) => (name === ROWS ? { column: null, agg: "count" as const, label: "Rows" } : { column: name, agg: "sum" as const, label: name });
  const g = (v: string) => (v === "auto" || v === "none" ? null : v);

  // Build the engine spec from the form. Column names must exist in this dataset.
  let spec: Record<string, unknown>;
  let title: string;
  const p = parsed.data as Record<string, any>;
  if (kind === "forecast" || kind === "trend") {
    if (!known(p.metric) || !cols.has(p.date)) return { ok: false, error: "Choose a measure and a date column from this dataset.", values };
    spec = { type: kind, metrics: [metric(p.metric)], time: { column: p.date, grain: g(p.grain) }, ...(kind === "forecast" ? { options: { horizon: p.horizon } } : {}) };
    title = kind === "forecast" ? `${p.metric === ROWS ? "Rows" : p.metric} forecast` : `${p.metric === ROWS ? "Rows" : p.metric} trend`;
  } else if (kind === "anomalies") {
    if (p.scope !== "records" && (!known(p.metric) || !p.date || !cols.has(p.date))) return { ok: false, error: "Choose a measure and a date column.", values };
    if (p.scope === "groups" && (!p.dimension || !cols.has(p.dimension))) return { ok: false, error: "Choose a grouping to check.", values };
    const metrics = p.scope === "records" ? (known(p.metric) && p.metric !== ROWS ? [metric(p.metric)] : []) : [metric(p.metric)];
    spec = {
      type: "anomalies", metrics, options: { scope: p.scope, sensitivity: p.sensitivity },
      ...(p.scope !== "records" ? { time: { column: p.date, grain: g(p.grain) } } : {}),
      ...(p.scope === "groups" ? { dimensions: [p.dimension] } : {}),
    };
    title = p.scope === "time" ? `Unusual periods in ${p.metric === ROWS ? "rows" : p.metric}` : p.scope === "groups" ? `Unusual changes by ${p.dimension}` : "Unusual rows";
  } else if (kind === "correlation") {
    const chosen = form.getAll("columns").map(String).filter((c) => cols.get(c)?.logical_type === "numeric").slice(0, 12);
    const date = stored.profile.columns.find((c) => c.role.role === "time")?.name;
    spec = { type: "correlation", metrics: chosen.map((c) => metric(c)), ...(g(p.grain) && date ? { time: { column: date, grain: g(p.grain) } } : {}) };
    title = "Relationships between measures";
  } else {
    spec = { type: "segmentation" };
    title = "Customer segments";
  }

  const columns = stored.profile.columns.map((c) => ({ name: c.name, logical_type: c.logical_type, role: c.role.role, concept: c.role.concept }));
  const started = Date.now();
  let id: string;
  try {
    const result = await analyzeDataset(workspace.id, dataset.id, spec, columns);
    id = await saveRun(kind, { workspaceId: workspace.id, datasetId: dataset.id, createdById: session.user.id, title, spec, result, durationMs: Date.now() - started });
  } catch (err) {
    if (err instanceof AnalysisExecutionError || err instanceof EngineRejected) return { ok: false, error: err.message, values };
    if (err instanceof EngineUnavailable) return { ok: false, error: "The data engine isn't reachable right now. Check that it's running, then try again.", values };
    logger.error("run.failed", { kind, ...errorFields(err) });
    return { ok: false, error: "Something went wrong while running this analysis. Your data was not modified.", values };
  }
  redirect(`/${PAGE_OF[kind]}?run=${id}${kind === "correlation" || kind === "segmentation" || kind === "trend" ? `&tab=${kind}` : ""}`);
}
