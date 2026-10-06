"use client";

import { renderInsight, type EngineResult, type ReportSummary } from "@insight/ai";
import { InsightText } from "@/components/analyst/InsightText";
import { KpiCards } from "@/components/charts/Chart";
import { formatMetric } from "@/lib/format";

const seg = (t: string, facts: EngineResult["facts"]) => renderInsight({ headline: t, what_happened: [], why: [], recommendations: [], caveats: [], document_notes: [] }, facts).headline;

export function BriefingView({ briefing, summary, compact }: { briefing: EngineResult & Record<string, any>; summary: ReportSummary; compact?: boolean }) {
  const b = briefing;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">{b.period.current}, compared with {b.period.baseline}</p>
      {b.stale ? <p role="status" className="rounded border border-caution/30 bg-caution/5 px-3 py-2 text-sm text-caution">{b.notes[0]}</p> : null}
      <KpiCards size={compact ? "sm" : "md"} kpis={b.kpis.map((k: any) => ({ label: k.label, value: k.value, format: k.format, changePct: k.change_pct }))} />
      {summary.executive_summary.length ? (
        <ul className="list-disc space-y-1 pl-5 text-ink-soft">{summary.executive_summary.map((t, i) => <li key={i}><InsightText segments={seg(t, b.facts)} /></li>)}</ul>
      ) : null}
      {!compact && b.movers.length ? (
        <div>
          <p className="text-sm font-semibold">Biggest movers</p>
          <ul className="mt-1 space-y-1 text-sm">
            {b.movers.map((m: any) => (
              <li key={m.dimension + m.value} className="flex justify-between gap-3">
                <span><span className="text-ink-muted">{m.dimension}</span> <span className="font-medium">{m.value}</span></span>
                <span className={`num ${m.change > 0 ? "text-up" : "text-down"}`}>{m.change > 0 ? "▲" : "▼"} {Math.abs(m.change_pct).toFixed(1)}% ({formatMetric(Math.abs(m.change), b.kpis[0]?.format ?? "number")})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!compact && b.unusual.length ? (
        <div><p className="text-sm font-semibold">Unusual</p><ul className="mt-1 space-y-1 text-sm text-ink-soft">{b.unusual.map((u: any) => <li key={u.period}>{u.label}: {u.reason}</li>)}</ul></div>
      ) : null}
      {!compact && summary.risks.length ? (
        <div><p className="text-sm font-semibold">Watch</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-soft">{summary.risks.map((t, i) => <li key={i}><InsightText segments={seg(t, b.facts)} /></li>)}</ul></div>
      ) : null}
      {!compact ? <ul className="space-y-0.5 text-xs text-ink-muted">{b.notes.filter((n: string) => !b.stale || n !== b.notes[0]).map((n: string) => <li key={n}>Note: {n}</li>)}</ul> : null}
    </div>
  );
}
