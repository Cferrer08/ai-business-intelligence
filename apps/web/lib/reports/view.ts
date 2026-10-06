// Turns stored report content into what the page and the PDF show. Pure functions, so the
// web view, the public share page and the PDF all render the same text and figures.
import { renderInsight, segmentsToText, templateInsight, type EngineResult, type Fact, type Segment } from "@insight/ai";
import { buildChart, type ChartSpec } from "@/lib/charts/build";
import { formatMetric } from "@/lib/format";
import type { ReportContent } from "@/lib/server/reports";

export interface SectionView {
  key: string;
  title: string;
  headline: Segment[];
  points: Segment[][];
  chart: ChartSpec | null;
  notes: string[];
  result: EngineResult;
}

export interface ReportView {
  summary: Segment[][];
  risks: Segment[][];
  actions: { action: Segment[]; reason: Segment[] }[];
  summarySource: "model" | "template";
  sections: SectionView[];
  skipped: { title: string; reason: string }[];
}

const toSegments = (text: string, facts: Fact[]) => renderInsight({ headline: text, what_happened: [], why: [], recommendations: [], caveats: [], document_notes: [] }, facts).headline;

export function reportView(content: ReportContent): ReportView {
  const facts = content.sections.flatMap((s) => s.result?.facts ?? []);
  const sections: SectionView[] = content.sections.filter((s) => s.status === "ok" && s.result).map((s) => {
    const r = s.result!;
    const t = renderInsight(templateInsight(r.type, r.facts, s.title), r.facts);
    const chart = buildChart(r, null);
    return {
      key: s.key, title: s.title, result: r, notes: r.notes,
      headline: segmentsToText(t.headline) === s.title ? [] : t.headline,
      // Key figures are shown as cards; don't repeat each total as a bullet.
      points: [...t.what_happened, ...t.why].filter((p) => s.key !== "overview" || !/^(Total|Distinct) /.test(segmentsToText(p))),
      chart: chart.type === "table" ? null : chart,
    };
  });
  return {
    summary: content.summary.executive_summary.map((x) => toSegments(x, facts)),
    risks: content.summary.risks.map((x) => toSegments(x, facts)),
    actions: content.summary.actions.map((a) => ({ action: toSegments(a.action, facts), reason: toSegments(a.reason, facts) })),
    summarySource: content.summary.source,
    sections,
    skipped: content.sections.filter((s) => s.status === "skipped").map((s) => ({ title: s.title, reason: s.reason ?? "" })),
  };
}

// ---- PDF payload (sent to the data engine's renderer) ----

const text = (s: Segment[]) => segmentsToText(s);

function pdfChart(c: ChartSpec) {
  if (["kpi", "table", "matrix", "donut", "scatter"].includes(c.type) || !c.data.length) return null;
  const type = c.type === "line" || c.type === "forecast" || c.type === "anomaly" ? "line"
    : c.type === "diverging" ? "diverging" : c.data.length > 8 && c.type === "bar" ? "hbar" : "bar";
  const keys = c.type === "forecast" ? [{ key: "actual", label: "Actual" }, { key: "forecast", label: "Forecast" }]
    : c.series.filter((s) => !s.dashed || c.type === "line").map((s) => ({ key: s.key, label: s.label }));
  return {
    type, labels: c.data.map((d) => String(d.__x)).slice(0, 60),
    series: keys.slice(0, 4).map((k) => ({ name: k.label, values: c.data.slice(0, 60).map((d) => (typeof d[k.key] === "number" ? (d[k.key] as number) : null)) })),
  };
}

function pdfTable(c: ChartSpec | null) {
  if (!c || c.type === "kpi" || !c.data.length || c.type === "matrix") return null;
  const series = c.series.filter((s) => !s.dashed).slice(0, 3);
  return {
    columns: [c.xLabel || "Label", ...series.map((s) => s.label)],
    rows: c.data.slice(0, 40).map((d) => [String(d.__x), ...series.map((s) => (typeof d[s.key] === "number" ? formatMetric(d[s.key] as number, s.format) : "—"))]),
  };
}

export function pdfPayload(title: string, content: ReportContent, generatedBy: string) {
  const v = reportView(content);
  return {
    title,
    subtitle: `Dataset: ${content.datasetName}. Generated ${new Date(content.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} by ${generatedBy}. All figures calculated by the InsightAI data engine.`,
    summary: v.summary.map(text),
    risks: v.risks.map(text),
    actions: v.actions.map((a) => `${text(a.action)} (${text(a.reason)})`),
    actions_note: v.summarySource === "template" ? "AI recommendations weren't available when this report was generated, so none are included." : null,
    sections: v.sections.map((s) => ({
      title: s.title,
      paragraphs: s.headline.length ? [text(s.headline)] : [],
      bullets: s.points.map(text).slice(0, 6),
      kpis: (s.chart?.type === "kpi" ? s.chart.kpis : []).slice(0, 8).map((k) => ({
        label: k.label, value: k.value == null ? "—" : formatMetric(k.value, k.format === "text" ? "number" : k.format),
        change: k.changePct == null ? null : `${k.changePct > 0 ? "▲" : k.changePct < 0 ? "▼" : "■"} ${Math.abs(k.changePct).toFixed(1)}%${k.note ? ` ${k.note}` : ""}`,
        direction: k.changePct == null ? null : k.changePct > 0 ? "up" : k.changePct < 0 ? "down" : "flat",
      })),
      chart: s.chart ? pdfChart(s.chart) : null,
      table: pdfTable(s.chart),
      notes: s.notes.slice(0, 6),
    })),
    skipped: v.skipped.map((s) => `${s.title}: ${s.reason}`),
    footer: `InsightAI · ${title}`.slice(0, 200),
  };
}

/** Every figure in the report as CSV rows: section, measure, value, as shown. */
export function factsCsv(content: ReportContent): string {
  const safe = (x: unknown) => {
    if (x == null) return "";
    if (typeof x === "number") return String(x);
    let s = String(x);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [["Section", "Measure", "Value", "As shown"].join(",")];
  for (const s of content.sections) for (const f of s.result?.facts ?? []) rows.push([s.title, f.label, f.kind === "text" ? "" : f.value, f.display].map(safe).join(","));
  return rows.join("\r\n");
}
