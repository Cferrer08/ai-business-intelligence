"use client";

import { useMemo } from "react";
import { renderInsight, templateInsight, type EngineResult } from "@insight/ai";
import { buildChart } from "@/lib/charts/build";
import { ChartPanel } from "@/components/charts/ChartPanel";
import { InsightText } from "@/components/analyst/InsightText";
import { ResultTables } from "@/components/analyst/ResultTables";
import { formatDate } from "@/lib/format";

/** A run's result: a summary written from the engine's facts (no AI), chart, table, notes. */
export function RunResult({ title, result, datasetName, createdAt }: { title: string; result: EngineResult; datasetName: string; createdAt: string }) {
  const spec = useMemo(() => buildChart(result, null), [result]);
  const rendered = useMemo(() => renderInsight(templateInsight(result.type, result.facts, title), result.facts), [result, title]);
  const r = result as EngineResult & Record<string, any>;
  return (
    <article className="rounded-lg border border-line bg-paper-raised">
      <header className="border-b border-line px-5 py-4">
        <p className="text-sm text-ink-muted">{title} · {datasetName} · {formatDate(createdAt, true)}</p>
        <h2 className="mt-1 text-lg font-semibold leading-snug"><InsightText segments={rendered.headline} /></h2>
        {rendered.what_happened.length ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">{rendered.what_happened.map((s, i) => <li key={i}><InsightText segments={s} /></li>)}</ul>
        ) : null}
        {rendered.why.length ? (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-soft">{rendered.why.map((s, i) => <li key={i}><InsightText segments={s} /></li>)}</ul>
        ) : null}
      </header>
      <div className="space-y-4 px-5 py-4">
        <ChartPanel spec={spec} title={title} table={<ResultTables result={result} />} />
        {r.type === "forecast" ? (
          <p className="text-sm text-ink-soft">
            Method: <span className="font-medium text-ink">{r.model.description}</span>, chosen from {r.backtest.candidates.length} methods tested on the
            last {r.backtest.steps} {r.grain}s of history, {r.backtest.folds} times.
          </p>
        ) : null}
        {r.type === "anomalies" ? <p className="text-sm text-ink-soft">Method: {r.method}.</p> : null}
        {result.notes.length ? <ul className="space-y-1 text-sm text-ink-muted">{result.notes.map((n) => <li key={n}>Note: {n}</li>)}</ul> : null}
        <p className="text-xs text-ink-muted">All numbers were calculated by the data engine. This summary is generated from those numbers without AI.</p>
      </div>
    </article>
  );
}
