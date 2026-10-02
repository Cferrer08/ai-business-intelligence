"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { AnalysisSpec, EngineResult } from "@insight/ai";
import { buildChart, PALETTE, type ChartSpec, type ChartType } from "@/lib/charts/build";
import { Chart } from "@/components/charts/Chart";
import { ChartPanel } from "@/components/charts/ChartPanel";
import { unpinChart } from "@/app/actions/charts";
import { formatDate } from "@/lib/format";

export function TrendChart({ series, label, format }: { series: { month: string; value: number; partial?: boolean }[]; label: string; format: "money" | "number" }) {
  const spec = useMemo<ChartSpec>(() => ({
    type: "line", options: ["line", "bar"], xKey: "__x", xLabel: "Month", xIsTime: true, kpis: [], topNAllowed: false,
    series: [{ key: "value", label, format, color: PALETTE[0] }],
    data: series.map((s) => ({ __x: new Date(s.month).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) + (s.partial ? " (partial)" : ""), value: s.value })),
    note: series.some((s) => s.partial) ? "The last month is still in progress in this data, so its total is incomplete." : undefined,
  }), [series, label, format]);
  return <ChartPanel spec={spec} title={`${label} by month`} />;
}

export function PinnedChart(props: { id: string; title: string; chartType: string; topN: number | null; result: EngineResult; plan: AnalysisSpec | null; conversationId: string; analysedAt: string; canEdit: boolean }) {
  const spec = useMemo(() => buildChart(props.result, props.plan), [props.result, props.plan]);
  const shown = props.topN && spec.topNAllowed ? { ...spec, data: spec.data.slice(0, props.topN) } : spec;
  const type = (spec.options.includes(props.chartType as ChartType) ? props.chartType : spec.type) as ChartType;
  return (
    <figure className="rounded-lg border border-line bg-paper-raised p-4">
      <figcaption className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{props.title}</p>
          <p className="text-xs text-ink-muted">Snapshot from an analysis on {formatDate(props.analysedAt)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          <Link href={`/analyst/${props.conversationId}`} className="text-signal hover:underline">Open</Link>
          {props.canEdit ? (
            <form action={unpinChart}>
              <input type="hidden" name="chartId" value={props.id} />
              <button type="submit" className="text-ink-muted hover:text-down">Unpin</button>
            </form>
          ) : null}
        </div>
      </figcaption>
      {type === "table" ? <p className="text-sm text-ink-soft">Pinned as a table. Open the analysis to see it.</p> : <Chart spec={shown} type={type} height={240} />}
    </figure>
  );
}

export function MiniChart({ result, plan }: { result: EngineResult; plan: AnalysisSpec | null }) {
  const spec = useMemo(() => buildChart(result, plan), [result, plan]);
  if (spec.type === "table" || spec.type === "kpi" || spec.data.length === 0) return null;
  return <Chart spec={{ ...spec, data: spec.data.slice(0, 12) }} height={64} compactMode />;
}
