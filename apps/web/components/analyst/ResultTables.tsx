import type { EngineResult } from "@insight/ai";
import { formatMetric } from "@/lib/format";

type Col = { key: string; label: string; kind: string; format: string; grain?: string };

function fmt(v: unknown, format: string, grain?: string): string {
  if (v == null) return "—";
  if (format === "percent") return formatMetric(Number(v), "percent");
  if (format === "date") {
    const d = new Date(String(v));
    if (grain === "month") return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    if (grain === "year") return String(d.getUTCFullYear());
    if (grain === "quarter") return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  if (format === "money" || format === "number") return formatMetric(Number(v), format);
  return String(v);
}

const th = "px-4 py-2 font-medium";
const td = "num px-4 py-2";

function Table({ columns, rows }: { columns: Col[]; rows: Record<string, unknown>[] }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded border border-line">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 border-b border-line bg-paper-raised text-ink-muted">
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={`${th} ${c.kind === "metric" ? "text-right" : ""}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c.key} className={`${td} ${c.kind === "metric" ? "text-right" : ""}`}>{fmt(r[c.key], c.format, c.grain)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultTables({ result }: { result: EngineResult }) {
  const r = result as EngineResult & Record<string, any>;
  if (r.type === "aggregate" && r.table) return <Table columns={r.table.columns} rows={r.table.rows} />;

  if (r.type === "compare_periods") {
    const s = r.summary;
    return (
      <div className="space-y-4">
        <Table
          columns={[
            { key: "metric", label: "Metric", kind: "dimension", format: "text" },
            { key: "baseline", label: r.period.baseline.label, kind: "metric", format: s.format },
            { key: "current", label: r.period.current.label + (r.period.current.partial ? " (partial)" : ""), kind: "metric", format: s.format },
            { key: "change_pct", label: "Change", kind: "metric", format: "percent" },
          ]}
          rows={[
            { metric: s.metric, baseline: s.baseline, current: s.current, change_pct: s.change_pct },
            ...s.other_metrics.map((o: any) => ({ metric: o.label, baseline: o.baseline, current: o.current, change_pct: o.baseline ? (100 * (o.current - o.baseline)) / Math.abs(o.baseline) : null })),
          ]}
        />
        {r.contributors.map((c: any) => (
          <div key={c.dimension}>
            <p className="mb-2 text-sm font-medium text-ink-soft">Contribution to the change by {c.dimension}</p>
            <Table
              columns={[
                { key: "value", label: c.dimension, kind: "dimension", format: "text" },
                { key: "baseline", label: r.period.baseline.label, kind: "metric", format: s.format },
                { key: "current", label: r.period.current.label, kind: "metric", format: s.format },
                { key: "change", label: "Change", kind: "metric", format: s.format },
                { key: "share_of_change", label: "Share of change", kind: "metric", format: "percent" },
              ]}
              rows={c.rows}
            />
          </div>
        ))}
      </div>
    );
  }

  if (r.type === "overview") {
    return (
      <div className="space-y-4">
        {r.summary_rows?.length ? (
          <Table columns={[{ key: "metric", label: "Measure", kind: "dimension", format: "text" }, { key: "value", label: "Value", kind: "metric", format: "number" }]} rows={r.summary_rows} />
        ) : null}
        {r.leaders?.length ? (
          <Table
            columns={[
              { key: "dimension", label: "Grouping", kind: "dimension", format: "text" },
              { key: "value", label: "Leader", kind: "dimension", format: "text" },
              { key: "amount", label: "Amount", kind: "metric", format: "number" },
              { key: "share", label: "Share", kind: "metric", format: "percent" },
            ]}
            rows={r.leaders}
          />
        ) : null}
      </div>
    );
  }
  return null;
}
