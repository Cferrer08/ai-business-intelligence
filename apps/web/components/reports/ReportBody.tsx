"use client";

import { useMemo } from "react";
import { InsightText } from "@/components/analyst/InsightText";
import { Chart, KpiCards } from "@/components/charts/Chart";
import { reportView } from "@/lib/reports/view";
import type { ReportContent } from "@/lib/server/reports";

export function ReportBody({ content }: { content: ReportContent }) {
  const v = useMemo(() => reportView(content), [content]);
  return (
    <div className="space-y-10">
      {v.summary.length ? (
        <section aria-labelledby="exec" className="rounded-lg border border-line bg-paper-raised px-6 py-5">
          <h2 id="exec" className="text-lg font-semibold">Executive summary</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink-soft">{v.summary.map((s, i) => <li key={i}><InsightText segments={s} /></li>)}</ul>
          <p className="mt-3 text-xs text-ink-muted">
            Highlighted figures were calculated by the data engine. {v.summarySource === "model" ? "The AI wrote the wording." : "This summary was generated from the figures without AI."}
          </p>
        </section>
      ) : null}

      {v.sections.map((s) => (
        <section key={s.key} aria-labelledby={`sec-${s.key}`} className="break-inside-avoid">
          <h2 id={`sec-${s.key}`} className="text-lg font-semibold">{s.title}</h2>
          {s.headline.length ? <p className="mt-1 text-ink"><InsightText segments={s.headline} /></p> : null}
          {s.points.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">{s.points.map((p, i) => <li key={i}><InsightText segments={p} /></li>)}</ul> : null}
          {s.chart ? (
            <div className="mt-4 rounded-lg border border-line bg-paper-raised p-4">
              {s.chart.type === "kpi" ? <KpiCards kpis={s.chart.kpis} /> : <Chart spec={s.chart} height={260} />}
            </div>
          ) : null}
          {s.notes.length ? <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">{s.notes.map((n) => <li key={n}>Note: {n}</li>)}</ul> : null}
        </section>
      ))}

      {v.risks.length ? (
        <section aria-labelledby="risks">
          <h2 id="risks" className="text-lg font-semibold">Key risks</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink-soft">{v.risks.map((s, i) => <li key={i}><InsightText segments={s} /></li>)}</ul>
        </section>
      ) : null}

      <section aria-labelledby="actions" className="rounded border border-dashed border-line bg-paper px-5 py-4">
        <h2 id="actions" className="text-lg font-semibold">Recommended actions <span className="text-sm font-normal text-ink-muted">(AI suggestions, not calculations)</span></h2>
        {v.actions.length ? (
          <ul className="mt-2 space-y-2 text-ink-soft">
            {v.actions.map((a, i) => <li key={i}><span className="text-ink"><InsightText segments={a.action} /></span> <span className="text-sm">— <InsightText segments={a.reason} /></span></li>)}
          </ul>
        ) : <p className="mt-2 text-sm text-ink-muted">AI recommendations weren&apos;t available when this report was generated, so none are included.</p>}
      </section>

      {v.skipped.length ? (
        <section aria-labelledby="skipped">
          <h2 id="skipped" className="text-sm font-semibold text-ink-soft">Not included</h2>
          <ul className="mt-1 space-y-0.5 text-sm text-ink-muted">{v.skipped.map((s) => <li key={s.title}>{s.title}: {s.reason}.</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}
