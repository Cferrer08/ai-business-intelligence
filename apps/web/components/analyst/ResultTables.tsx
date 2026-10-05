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

  if (r.type === "forecast") {
    const f = r.summary.format;
    return (
      <div className="space-y-4">
        <Table
          columns={[
            { key: "period", label: "Period", kind: "dimension", format: "date", grain: r.grain },
            { key: "value", label: `Forecast ${r.summary.metric}`, kind: "metric", format: f },
            { key: "range80", label: "Likely range (80%)", kind: "dimension", format: "text" },
            { key: "range95", label: "Wider range (95%)", kind: "dimension", format: "text" },
          ]}
          rows={r.forecast.map((x: any) => ({ ...x, range80: `${fmt(x.lo80, f)} to ${fmt(x.hi80, f)}`, range95: `${fmt(x.lo95, f)} to ${fmt(x.hi95, f)}` }))}
        />
        <div>
          <p className="mb-2 text-sm font-medium text-ink-soft">Methods tested on past data (lower error is better)</p>
          <Table
            columns={[
              { key: "description", label: "Method", kind: "dimension", format: "text" },
              { key: "mae", label: "Typical error", kind: "metric", format: f },
              { key: "chosen", label: "", kind: "dimension", format: "text" },
            ]}
            rows={r.backtest.candidates.map((c: any) => ({ ...c, chosen: c.name === r.model.name ? "Chosen" : "" }))}
          />
        </div>
      </div>
    );
  }

  if (r.type === "anomalies") {
    if (r.scope === "time") {
      return r.flags.length ? (
        <Table
          columns={[
            { key: "label", label: "Period", kind: "dimension", format: "text" },
            { key: "value", label: r.summary.metric, kind: "metric", format: r.summary.format },
            { key: "expected", label: "Expected", kind: "metric", format: r.summary.format },
            { key: "deviation_pct", label: "Difference", kind: "metric", format: "percent" },
            { key: "reason", label: "Why it was flagged", kind: "dimension", format: "text" },
          ]}
          rows={r.flags}
        />
      ) : <p className="text-sm text-ink-soft">Nothing unusual at this sensitivity.</p>;
    }
    if (r.scope === "groups") {
      return (
        <Table
          columns={[
            { key: "value", label: r.dimension, kind: "dimension", format: "text" },
            { key: "current", label: r.period, kind: "metric", format: r.summary.format },
            { key: "typical", label: "Expected", kind: "metric", format: r.summary.format },
            { key: "deviation_pct", label: "Difference", kind: "metric", format: "percent" },
            { key: "status", label: "", kind: "dimension", format: "text" },
          ]}
          rows={r.groups.map((g: any) => ({ ...g, status: g.flagged ? "Unusual" : "" }))}
        />
      );
    }
    return r.flags.length ? (
      <Table
        columns={[
          { key: "row", label: "Row", kind: "dimension", format: "text" },
          ...r.id_columns.map((c: string) => ({ key: c, label: c, kind: "dimension", format: "text" })),
          ...r.columns.map((c: string) => ({ key: c, label: c, kind: "metric", format: "number" })),
          { key: "reason", label: "Why it was flagged", kind: "dimension", format: "text" },
        ]}
        rows={r.flags}
      />
    ) : <p className="text-sm text-ink-soft">No unusual rows at this sensitivity.</p>;
  }

  if (r.type === "correlation") {
    return (
      <Table
        columns={[
          { key: "pair", label: "Measures", kind: "dimension", format: "text" },
          { key: "spearman", label: "Rank correlation", kind: "metric", format: "number" },
          { key: "strength", label: "Strength", kind: "dimension", format: "text" },
          { key: "clear", label: "Statistically clear", kind: "dimension", format: "text" },
          { key: "n", label: "Rows", kind: "metric", format: "number" },
        ]}
        rows={r.pairs.map((p: any) => ({ ...p, pair: `${p.a} and ${p.b}`, spearman: Math.round(p.spearman * 100) / 100, clear: p.significant ? "Yes" : "No" }))}
      />
    );
  }

  if (r.type === "segmentation") {
    return (
      <Table
        columns={[
          { key: "segment", label: "Segment", kind: "dimension", format: "text" },
          { key: "description", label: "Who they are", kind: "dimension", format: "text" },
          { key: "customers", label: "Customers", kind: "metric", format: "number" },
          { key: "share_revenue", label: "Share of revenue", kind: "metric", format: "percent" },
          { key: "avg_recency_days", label: "Days since last purchase", kind: "metric", format: "number" },
          { key: "avg_frequency", label: "Purchases", kind: "metric", format: "number" },
          { key: "avg_monetary", label: "Spend per customer", kind: "metric", format: "money" },
          { key: "examples", label: "Top customers", kind: "dimension", format: "text" },
        ]}
        rows={r.segments.map((s: any) => ({ ...s, examples: s.top_customers.slice(0, 3).join(", ") }))}
      />
    );
  }

  if (r.type === "trend") {
    return (
      <Table
        columns={[
          { key: "label", label: "Period", kind: "dimension", format: "text" },
          { key: "value", label: r.summary.metric, kind: "metric", format: r.summary.format },
          { key: "trend", label: "Trend line", kind: "metric", format: r.summary.format },
        ]}
        rows={r.series}
      />
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
