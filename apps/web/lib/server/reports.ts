import "server-only";
import { AnalysisExecutionError, summarizeReport, type EngineResult, type ReportSectionInput, type ReportSummary } from "@insight/ai";
import type { DatasetProfile } from "@insight/types";
import { analyzeDataset, EngineRejected, EngineUnavailable, type ColumnRoleInput } from "./engine";
import { getLlm, recordAiUsage } from "./ai";

export interface ReportSection {
  key: string;
  title: string;
  spec: Record<string, unknown> | null;
  status: "ok" | "skipped";
  reason?: string;
  result?: EngineResult;
}

export interface ReportContent {
  version: 1;
  datasetName: string;
  periodLabel: string | null;
  generatedAt: string;
  sections: ReportSection[];
  summary: ReportSummary;
}

type Planned = { key: string; title: string; spec: Record<string, unknown> | null; reason?: string };

/** Choose report sections from the dataset's verified column roles. */
export function planSections(profile: DatasetProfile): Planned[] {
  const col = (role: string, concept?: string) => profile.columns.find((c) => c.role.role === role && (!concept || c.role.concept === concept))?.name;
  const time = col("time");
  const money = col("monetary", "revenue") ?? col("monetary", "amount") ?? col("monetary") ?? col("quantity");
  const geo = col("geographic");
  const product = profile.columns.find((c) => c.role.concept === "product" && ["categorical", "identifier"].includes(c.logical_type))?.name
    ?? profile.columns.find((c) => c.role.role === "category")?.name;
  const customer = col("identifier", "customer");
  const daily = profile.columns.find((c) => c.name === time)?.stats?.granularity === "daily";
  const m = money ? [{ column: money, agg: "sum", label: "Revenue" }] : [];
  const need = (ok: unknown, reason: string) => (ok ? undefined : reason);
  const plans: Planned[] = [
    { key: "overview", title: "Key figures", spec: { type: "overview" } },
    { key: "revenue_trend", title: "Revenue by month", reason: need(time && money, "needs a date column and a revenue or quantity column"),
      spec: { type: "aggregate", metrics: m, time: { column: time, grain: "month" } } },
    { key: "trend", title: "Is revenue growing?", reason: need(time && money, "needs a date column and a revenue or quantity column"),
      spec: { type: "trend", metrics: m, time: { column: time, grain: "month" } } },
    { key: "change_drivers", title: "What changed last month", reason: need(time && money, "needs a date column and a revenue or quantity column"),
      spec: { type: "compare_periods", metrics: m, dimensions: [geo, product].filter(Boolean).slice(0, 2), time: { column: time },
        period: { kind: "latest_complete", unit: "month" }, comparison: "previous_period" } },
    { key: "products", title: "Product performance", reason: need(money && product, "no product or category column was recognised"),
      spec: { type: "aggregate", metrics: m, dimensions: [product], sort: { by: "Revenue", direction: "desc" }, limit: 10 } },
    { key: "regions", title: "Regional performance", reason: need(money && geo, "no region or location column was recognised"),
      spec: { type: "aggregate", metrics: m, dimensions: [geo], sort: { by: "Revenue", direction: "desc" }, limit: 12 } },
    { key: "customers", title: "Customer segments", reason: need(customer && time && money, "no customer id column was recognised"),
      spec: { type: "segmentation" } },
    { key: "anomalies_time", title: daily ? "Unusual days" : "Unusual periods", reason: need(time && money, "needs a date column and a revenue or quantity column"),
      spec: { type: "anomalies", metrics: m, time: { column: time, grain: daily ? "day" : null }, options: { scope: "time" } } },
    { key: "anomalies_groups", title: "Regions with an unusual month", reason: need(time && money && geo, "no region or location column was recognised"),
      spec: { type: "anomalies", metrics: m, dimensions: [geo], time: { column: time, grain: "month" }, options: { scope: "groups" } } },
    { key: "forecast", title: "Forecast", reason: need(time && money, "needs a date column and a revenue or quantity column"),
      spec: { type: "forecast", metrics: m, time: { column: time, grain: "month" }, options: { horizon: 3 } } },
  ];
  return plans.map((p) => (p.reason ? { ...p, spec: null } : p));
}

export async function buildReport(opts: { workspaceId: string; userId: string; datasetId: string; datasetName: string; profile: DatasetProfile }): Promise<ReportContent> {
  const columns: ColumnRoleInput[] = opts.profile.columns.map((c) => ({ name: c.name, logical_type: c.logical_type, role: c.role.role, concept: c.role.concept }));
  const planned = planSections(opts.profile);
  const runs = await Promise.allSettled(planned.map((p) => (p.spec ? analyzeDataset(opts.workspaceId, opts.datasetId, p.spec, columns) : Promise.reject(null))));
  const sections: ReportSection[] = [];
  let unavailable = 0;
  runs.forEach((r, i) => {
    const p = planned[i];
    if (r.status === "fulfilled") return sections.push({ key: p.key, title: p.title, spec: p.spec, status: "ok", result: r.value });
    const e = r.reason;
    if (e instanceof EngineUnavailable) unavailable++;
    const reason = p.reason ?? (e instanceof AnalysisExecutionError || e instanceof EngineRejected ? e.message : "it couldn't be calculated");
    sections.push({ key: p.key, title: p.title, spec: p.spec, status: "skipped", reason });
  });
  if (unavailable === planned.filter((p) => p.spec).length) throw new EngineUnavailable("engine unreachable");

  // Renumber facts so every placeholder is unique across the whole report.
  let n = 0;
  for (const s of sections) {
    if (!s.result) continue;
    const map = new Map<string, string>();
    s.result = { ...s.result, facts: s.result.facts.map((f) => { const id = `f${++n}`; map.set(f.id, id); return { ...f, id }; }) };
  }

  const inputs: ReportSectionInput[] = sections.filter((s) => s.result).map((s) => ({
    key: s.key, title: s.title, type: s.result!.type, facts: s.result!.facts, notes: s.result!.notes, labels: s.result!.labels,
  }));
  const llm = getLlm();
  const summary = await summarizeReport(inputs, llm, (purpose, usage, ok, errorCode) =>
    recordAiUsage({ workspaceId: opts.workspaceId, userId: opts.userId, analysisRequestId: null, purpose, model: llm?.model ?? "none", usage, succeeded: ok, errorCode }));
  const drivers = sections.find((s) => s.key === "change_drivers")?.result as (EngineResult & { period?: { current: { label: string } } }) | undefined;
  return {
    version: 1, datasetName: opts.datasetName, periodLabel: drivers?.period?.current.label ?? null,
    generatedAt: new Date().toISOString(), sections, summary,
  };
}
