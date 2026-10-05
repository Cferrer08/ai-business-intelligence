"use client";

import { useMemo, useRef, useState } from "react";
import type { ChartSpec, ChartType } from "@/lib/charts/build";
import { chartCsv } from "@/lib/charts/build";
import { exportCsv, exportPng, exportSvg } from "@/lib/charts/export";
import { Chart } from "./Chart";

const LABEL: Record<ChartType, string> = {
  line: "Line", bar: "Bar", donut: "Pie", scatter: "Scatter", histogram: "Histogram", diverging: "Bar", kpi: "Summary", table: "Table",
  forecast: "Forecast", anomaly: "Line", matrix: "Matrix",
};

export interface PanelState { type: ChartType; topN: number | null }

export function ChartPanel({
  spec, title, table, initial, onChange, actions,
}: {
  spec: ChartSpec;
  title: string;
  table?: React.ReactNode;
  initial?: Partial<PanelState>;
  onChange?: (s: PanelState) => void;
  actions?: (s: PanelState) => React.ReactNode;
}) {
  const [type, setType] = useState<ChartType>(initial?.type && spec.options.includes(initial.type) ? initial.type : spec.type);
  const [topN, setTopN] = useState<number | null>(initial?.topN ?? null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const big = useRef<HTMLDivElement>(null);

  const shown = useMemo<ChartSpec>(() => (topN && spec.topNAllowed ? { ...spec, data: spec.data.slice(0, topN) } : spec), [spec, topN]);
  const update = (s: Partial<PanelState>) => {
    const next = { type, topN, ...s };
    if (s.type) setType(s.type);
    if ("topN" in s) setTopN(s.topN ?? null);
    onChange?.(next);
  };
  const toggle = (key: string) => setHidden((h) => {
    const n = new Set(h);
    if (n.has(key)) n.delete(key); else if (spec.series.length - n.size > 1) n.add(key);
    return n;
  });
  const flash = (m: string) => { setStatus(m); setTimeout(() => setStatus(null), 2500); };
  const target = () => (expanded ? big.current : box.current);

  const isChart = type !== "table" && type !== "kpi";
  const isSvg = isChart && type !== "matrix";
  const body = (height: number, ref: React.RefObject<HTMLDivElement | null>) =>
    type === "table" ? table ?? null : (
      <div ref={ref}>
        <Chart spec={shown} type={type} height={height} hidden={hidden} onToggleSeries={toggle} timeBrush={expanded} />
      </div>
    );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {spec.options.length > 1 ? (
        <div role="group" aria-label="Chart type" className="inline-flex overflow-hidden rounded border border-line">
          {spec.options.map((o) => (
            <button key={o} type="button" aria-pressed={type === o} onClick={() => update({ type: o })}
              className={`px-2.5 py-1 ${type === o ? "bg-ink text-white" : "bg-paper-raised text-ink-soft hover:text-ink"}`}>{LABEL[o]}</button>
          ))}
        </div>
      ) : null}
      {spec.topNAllowed && isChart ? (
        <label className="inline-flex items-center gap-1.5 text-ink-soft">
          Show
          <select value={topN ?? 0} onChange={(e) => update({ topN: Number(e.target.value) || null })} className="rounded border border-line bg-paper-raised px-1.5 py-1 text-ink">
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
            <option value={0}>All</option>
          </select>
        </label>
      ) : null}
      <span className="flex-1" />
      {isChart ? (
        <>
          <button type="button" onClick={() => setExpanded(true)} className="rounded border border-line bg-paper-raised px-2.5 py-1 text-ink-soft hover:text-ink">Expand</button>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded border border-line bg-paper-raised px-2.5 py-1 text-ink-soft hover:text-ink">Download</summary>
            <div className="absolute right-0 z-20 mt-1 w-36 rounded border border-line bg-paper-raised py-1 shadow-lg">
              {isSvg ? (
                <>
                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-paper" onClick={async (e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; flash((await exportPng(target()!, title)) ? "PNG downloaded" : "Couldn't export this chart"); }}>Image (PNG)</button>
                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-paper" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; flash(exportSvg(target()!, title) ? "SVG downloaded" : "Couldn't export this chart"); }}>Vector (SVG)</button>
                </>
              ) : null}
              <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-paper" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; exportCsv(chartCsv(shown, type), title); flash("CSV downloaded"); }}>Data (CSV)</button>
            </div>
          </details>
        </>
      ) : null}
      {actions?.({ type, topN })}
      {status ? <span role="status" className="text-up">{status}</span> : null}
    </div>
  );

  return (
    <div className="space-y-3">
      {toolbar}
      {body(320, box)}
      {spec.note ? <p className="text-sm text-ink-muted">{spec.note}</p> : null}
      {type !== "table" && table ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink">Show data</summary>
          <div className="mt-2">{table}</div>
        </details>
      ) : null}
      {hidden.size ? <p className="text-xs text-ink-muted">Hidden series: {[...hidden].join(", ")}. Click the legend to show them again.</p> : null}
      {expanded ? (
        <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") setExpanded(false); }}>
          <div className="w-full max-w-6xl rounded-lg bg-paper-raised p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h3 className="text-lg font-semibold">{title}</h3>
              <button type="button" autoFocus onClick={() => setExpanded(false)} className="rounded border border-line px-3 py-1 text-sm hover:bg-paper">Close</button>
            </div>
            {toolbar}
            <div className="mt-3">{body(Math.min(560, typeof window !== "undefined" ? window.innerHeight - 220 : 520), big)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
