/**
 * Turns an engine result into a chart specification. Charts only ever use the engine's
 * calculated values; nothing is estimated or interpolated. The default chart type follows
 * from the shape of the result; a type the user asked for is used only if it suits the data.
 */
import type { AnalysisSpec, EngineResult } from "@insight/ai";

export type ChartType = "line" | "bar" | "donut" | "scatter" | "histogram" | "diverging" | "kpi" | "table";
export type ValueFormat = "money" | "number" | "percent" | "text";

export interface Series { key: string; label: string; format: ValueFormat; color: string }
export interface Kpi { label: string; value: number | null; format: ValueFormat; changePct?: number | null; note?: string }

export interface ChartSpec {
  type: ChartType;
  options: ChartType[];
  data: Record<string, string | number | null>[];
  xKey: string;
  xLabel: string;
  xIsTime: boolean;
  series: Series[];
  kpis: Kpi[];
  labelKey?: string;          // scatter points are named by this key
  topNAllowed: boolean;       // ranking charts can be cut to top 5 / 10
  note?: string;              // e.g. why a requested type wasn't used
}

export const PALETTE = ["#1D5FBF", "#C2410C", "#0F766E", "#7C3AED", "#B45309", "#475569"];
const MAX_SERIES = 6;
const TYPE_NAMES: Record<string, string> = { line: "line", bar: "bar", donut: "pie", scatter: "scatter", histogram: "histogram", table: "table" };

type Col = { key: string; label: string; kind: string; format: string; grain?: string };

function timeLabel(v: unknown, grain?: string): string {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  if (grain === "year") return String(d.getUTCFullYear());
  if (grain === "quarter") return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  if (grain === "month") return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const fmtOf = (f: string): ValueFormat => (f === "money" || f === "percent" || f === "number" ? f : "number");

/** Pivot long rows (time/dim1, dim2, value) into one column per top series value. */
function pivot(rows: Record<string, any>[], xKey: string, seriesKey: string, valueKey: string, xLabel: (v: unknown) => string) {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(String(r[seriesKey]), (totals.get(String(r[seriesKey])) ?? 0) + Math.abs(Number(r[valueKey]) || 0));
  const keep = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_SERIES).map(([k]) => k);
  const byX = new Map<string, Record<string, any>>();
  const order: string[] = [];
  for (const r of rows) {
    const s = String(r[seriesKey]);
    if (!keep.includes(s)) continue;
    const x = String(r[xKey]);
    if (!byX.has(x)) { byX.set(x, { __x: xLabel(r[xKey]), __sort: r[xKey] }); order.push(x); }
    byX.get(x)![s] = r[valueKey];
  }
  const data = order.map((x) => byX.get(x)!).sort((a, b) => (a.__sort < b.__sort ? -1 : a.__sort > b.__sort ? 1 : 0)).map(({ __sort, ...rest }) => rest);
  return { data, keep, dropped: totals.size - keep.length };
}

export function buildChart(result: EngineResult, plan: AnalysisSpec | null): ChartSpec {
  const r = result as EngineResult & Record<string, any>;
  const base: ChartSpec = { type: "table", options: ["table"], data: [], xKey: "__x", xLabel: "", xIsTime: false, series: [], kpis: [], topNAllowed: false };
  let spec = base;

  if (r.type === "aggregate" && r.table) {
    const cols: Col[] = r.table.columns;
    const rows: Record<string, any>[] = r.table.rows;
    const time = cols.find((c) => c.kind === "time");
    const dims = cols.filter((c) => c.kind === "dimension");
    const metrics = cols.filter((c) => c.kind === "metric");
    const series = (ms: Col[]): Series[] => ms.slice(0, 2).map((m, i) => ({ key: m.key, label: m.label, format: fmtOf(m.format), color: PALETTE[i] }));

    if (!time && dims.length === 0) {
      spec = { ...base, type: "kpi", options: ["kpi", "table"], kpis: metrics.map((m) => ({ label: m.label, value: rows[0]?.[m.key] ?? null, format: fmtOf(m.format) })) };
    } else if (time && dims.length === 0) {
      spec = {
        ...base, type: "line", options: ["line", "bar", "table"], xLabel: time.label, xIsTime: true, series: series(metrics),
        data: rows.map((row) => ({ __x: timeLabel(row[time.key], time.grain), ...Object.fromEntries(metrics.map((m) => [m.key, row[m.key]])) })),
      };
    } else if ((time && dims.length === 1) || dims.length === 2) {
      const x = time ?? dims[0];
      const s = time ? dims[0] : dims[1];
      const m = metrics[0];
      const p = pivot(rows, x.key, s.key, m.key, (v) => (time ? timeLabel(v, time.grain) : String(v)));
      spec = {
        ...base, type: time ? "line" : "bar", options: time ? ["line", "bar", "table"] : ["bar", "table"], xLabel: x.label, xIsTime: Boolean(time), data: p.data,
        series: p.keep.map((k, i) => ({ key: k, label: k, format: fmtOf(m.format), color: PALETTE[i] })),
        note: p.dropped > 0 ? `Showing the ${p.keep.length} largest ${s.label} values; ${p.dropped} more are in the table.` : undefined,
      };
    } else {
      const d = dims[0];
      const data = rows.map((row) => ({ __x: String(row[d.key]), ...Object.fromEntries(metrics.map((m) => [m.key, row[m.key]])) }));
      const options: ChartType[] = ["bar"];
      const first = metrics[0];
      const additive = plan?.metrics?.[0] && ["sum", "count", "count_distinct"].includes(plan.metrics[0].agg) && first?.format !== "percent";
      const complete = (r.groups_total ?? rows.length) === rows.length;
      if (additive && complete && rows.length >= 2 && rows.length <= 8 && rows.every((x) => Number(x[first.key]) >= 0)) options.push("donut");
      if (metrics.length >= 2 && rows.length >= 3) options.push("scatter");
      options.push("table");
      spec = { ...base, type: "bar", options, xLabel: d.label, series: series(metrics), data, labelKey: "__x", topNAllowed: rows.length > 5 };
    }
  } else if (r.type === "compare_periods") {
    const s = r.summary;
    const kpis: Kpi[] = [
      { label: `${s.metric}, ${r.period.current.label}`, value: s.current, format: fmtOf(s.format), changePct: s.change_pct, note: `vs ${r.period.baseline.label}` },
      { label: `${s.metric}, ${r.period.baseline.label}`, value: s.baseline, format: fmtOf(s.format) },
    ];
    const c = r.contributors?.[0];
    spec = c
      ? {
          ...base, type: "diverging", options: ["diverging", "table"], xLabel: c.dimension, kpis, labelKey: "__x", topNAllowed: c.rows.length > 5,
          series: [{ key: "change", label: `Change in ${s.metric}`, format: fmtOf(s.format), color: PALETTE[0] }],
          data: c.rows.map((x: any) => ({ __x: x.value, change: x.change, share: x.share_of_change })),
        }
      : { ...base, type: "kpi", options: ["kpi", "table"], kpis };
  } else if (r.type === "distribution") {
    const s = r.summary;
    spec = {
      ...base, type: "histogram", options: ["histogram", "table"], xLabel: s.metric,
      series: [{ key: "count", label: "Number of values", format: "number", color: PALETTE[0] }],
      data: r.bins.map((b: any) => ({ __x: b.label, count: b.count, share: b.share })),
    };
  } else if (r.type === "overview") {
    const kpis: Kpi[] = (r.summary_rows ?? []).map((x: any) => ({ label: x.metric, value: x.value, format: fmtOf(x.format) }));
    if (r.trend) kpis.push({ label: `${r.trend.metric}, ${r.trend.period.current.label}`, value: r.trend.current, format: fmtOf(r.trend.format), changePct: r.trend.change_pct, note: `vs ${r.trend.period.baseline.label}` });
    spec = { ...base, type: kpis.length ? "kpi" : "table", options: kpis.length ? ["kpi", "table"] : ["table"], kpis };
  }

  // A chart type the user asked for, if it suits the result.
  const want = plan?.chart;
  if (want && want !== "auto") {
    if (spec.options.includes(want as ChartType)) spec = { ...spec, type: want as ChartType };
    else spec = { ...spec, note: `A ${TYPE_NAMES[want] ?? want} chart doesn't suit this result, so a ${spec.type === "kpi" ? "summary" : TYPE_NAMES[spec.type] ?? spec.type} view is shown.` };
  }
  return spec;
}

/** Rows for CSV export: the chart's own data with readable headers. */
export function chartCsv(spec: ChartSpec): string {
  const safe = (v: unknown) => {
    if (v == null) return "";
    if (typeof v === "number") return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheets treating text as formulas
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  if (spec.type === "kpi" || spec.data.length === 0) {
    return ["Measure,Value,Change %", ...spec.kpis.map((k) => [safe(k.label), safe(k.value), safe(k.changePct ?? "")].join(","))].join("\r\n");
  }
  const extra = spec.data.some((d) => "share" in d) ? ["share"] : [];
  const header = [spec.xLabel || "Label", ...spec.series.map((s) => s.label), ...extra.map(() => "Share %")];
  const lines = spec.data.map((d) => [safe(d.__x), ...spec.series.map((s) => safe(d[s.key])), ...extra.map((k) => safe(d[k]))].join(","));
  return [header.map(safe).join(","), ...lines].join("\r\n");
}
