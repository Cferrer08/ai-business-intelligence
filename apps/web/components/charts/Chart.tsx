"use client";

import {
  Bar, BarChart, Brush, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import type { ChartSpec, ChartType, Kpi, ValueFormat } from "@/lib/charts/build";
import { PALETTE } from "@/lib/charts/build";
import { formatMetric, formatNumber } from "@/lib/format";

const INK = "#3A4656";
const GRID = "#E3E8EE";
const UP = "#1E7A4F";
const DOWN = "#B42318";

const axisTick = { fill: "#6B7685", fontSize: 12 };
const fmt = (v: unknown, f: ValueFormat) => formatMetric(typeof v === "number" ? v : Number(v), f === "text" ? "number" : f);
const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
  return formatNumber(v);
};

function useReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function KpiCards({ kpis, size = "md" }: { kpis: Kpi[]; size?: "sm" | "md" }) {
  return (
    <dl className={`grid gap-px overflow-hidden rounded border border-line bg-line ${kpis.length > 3 ? "grid-cols-2 lg:grid-cols-4" : kpis.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {kpis.map((k) => (
        <div key={k.label} className="bg-paper-raised px-4 py-3">
          <dt className="truncate text-sm text-ink-muted" title={k.label}>{k.label}</dt>
          <dd className={`num mt-0.5 font-semibold ${size === "sm" ? "text-lg" : "text-2xl"}`}>{k.value == null ? "—" : fmt(k.value, k.format)}</dd>
          {k.changePct != null ? (
            <dd className={`num text-sm ${k.changePct > 0 ? "text-up" : k.changePct < 0 ? "text-down" : "text-ink-muted"}`}>
              {k.changePct > 0 ? "▲" : k.changePct < 0 ? "▼" : "■"} {Math.abs(k.changePct).toFixed(1)}%{k.note ? <span className="text-ink-muted"> {k.note}</span> : null}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

interface Props {
  spec: ChartSpec;
  type?: ChartType;
  height?: number;
  hidden?: Set<string>;
  onToggleSeries?: (key: string) => void;
  compactMode?: boolean; // small previews: no axes labels, legend or brush
  timeBrush?: boolean;
}

export function Chart({ spec, type = spec.type, height = 320, hidden, onToggleSeries, compactMode, timeBrush }: Props) {
  const reduced = useReducedMotion();
  const anim = { isAnimationActive: !reduced && !compactMode, animationDuration: 400 };
  const series = spec.series.filter((s) => !hidden?.has(s.key));
  const data = spec.data;
  const primaryFormat = spec.series[0]?.format ?? "number";
  const tooltip = (
    <Tooltip
      cursor={{ fill: "rgba(29,95,191,0.06)" }}
      contentStyle={{ borderRadius: 6, borderColor: "#D7DDE4", fontSize: 13 }}
      formatter={(v: unknown, name: unknown) => {
        const s = spec.series.find((x) => x.key === name || x.label === name);
        return [fmt(v, s?.format ?? primaryFormat), s?.label ?? String(name)];
      }}
    />
  );
  const legend = !compactMode && spec.series.length > 1 ? (
    <Legend
      wrapperStyle={{ fontSize: 13, cursor: onToggleSeries ? "pointer" : "default" }}
      onClick={(e: any) => onToggleSeries?.(String(e.dataKey))}
      formatter={(value: string, entry: any) => <span style={{ color: hidden?.has(String(entry.dataKey)) ? "#A0A8B3" : INK }}>{value}</span>}
    />
  ) : null;
  const longLabels = data.some((d) => String(d.__x).length > 14) || data.length > 8;

  if (type === "kpi") return <KpiCards kpis={spec.kpis} size={compactMode ? "sm" : "md"} />;

  let chart: React.ReactElement;
  if (type === "line") {
    chart = (
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        {!compactMode && <CartesianGrid stroke={GRID} vertical={false} />}
        <XAxis dataKey="__x" tick={axisTick} hide={compactMode} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
        <YAxis tick={axisTick} hide={compactMode} tickFormatter={compact} width={56} tickLine={false} axisLine={false} />
        {!compactMode && tooltip}
        {legend}
        {series.map((s) => <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={data.length <= 24 && !compactMode ? { r: 3 } : false} {...anim} />)}
        {timeBrush && data.length > 12 ? <Brush dataKey="__x" height={22} stroke="#1D5FBF" travellerWidth={8} /> : null}
      </LineChart>
    );
  } else if (type === "donut") {
    const s = spec.series[0];
    const total = data.reduce((a, d) => a + (Number(d[s.key]) || 0), 0);
    chart = (
      <PieChart>
        <Pie data={data} dataKey={s.key} nameKey="__x" innerRadius="55%" outerRadius="85%" paddingAngle={1} stroke="#fff" {...anim}
          label={compactMode ? false : ({ name, value }: any) => `${name} ${total ? ((100 * value) / total).toFixed(0) : 0}%`} labelLine={false}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        {!compactMode && <Tooltip formatter={(v: unknown) => [fmt(v, s.format), s.label]} contentStyle={{ borderRadius: 6, fontSize: 13 }} />}
      </PieChart>
    );
  } else if (type === "scatter") {
    const [x, y] = spec.series;
    chart = (
      <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        {!compactMode && <CartesianGrid stroke={GRID} />}
        <XAxis type="number" dataKey={x.key} name={x.label} tick={axisTick} hide={compactMode} tickFormatter={compact} label={compactMode ? undefined : { value: x.label, position: "insideBottom", offset: -4, fill: "#6B7685", fontSize: 12 }} />
        <YAxis type="number" dataKey={y.key} name={y.label} tick={axisTick} hide={compactMode} tickFormatter={compact} width={56} label={compactMode ? undefined : { value: y.label, angle: -90, position: "insideLeft", fill: "#6B7685", fontSize: 12 }} />
        <ZAxis range={[60, 60]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ payload }: any) => {
            const p = payload?.[0]?.payload;
            if (!p) return null;
            return (
              <div className="rounded border border-line bg-paper-raised px-3 py-2 text-sm shadow">
                <p className="font-semibold">{p.__x}</p>
                <p>{x.label}: {fmt(p[x.key], x.format)}</p>
                <p>{y.label}: {fmt(p[y.key], y.format)}</p>
              </div>
            );
          }}
        />
        <Scatter data={data} fill={PALETTE[0]} {...anim} />
      </ScatterChart>
    );
  } else {
    // bar, histogram, diverging
    const horizontal = (type === "bar" || type === "diverging") && longLabels && !compactMode;
    const diverging = type === "diverging";
    chart = (
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 16, bottom: 0, left: horizontal ? 8 : 0 }} barCategoryGap={type === "histogram" ? 1 : "20%"}>
        {!compactMode && <CartesianGrid stroke={GRID} vertical={horizontal} horizontal={!horizontal} />}
        {horizontal ? (
          <>
            <XAxis type="number" tick={axisTick} tickFormatter={compact} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis type="category" dataKey="__x" tick={axisTick} width={Math.min(180, 12 + 7 * Math.max(...data.map((d) => String(d.__x).length)))} tickLine={false} axisLine={false} interval={0} />
          </>
        ) : (
          <>
            <XAxis dataKey="__x" tick={axisTick} hide={compactMode} tickLine={false} axisLine={{ stroke: GRID }} interval={type === "histogram" ? "preserveStartEnd" : 0} minTickGap={8} />
            <YAxis tick={axisTick} hide={compactMode} tickFormatter={compact} width={56} tickLine={false} axisLine={false} />
          </>
        )}
        {!compactMode && tooltip}
        {legend}
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={type === "histogram" ? 0 : 2} {...anim}>
            {diverging ? data.map((d, i) => <Cell key={i} fill={Number(d[s.key]) >= 0 ? UP : DOWN} />) : null}
          </Bar>
        ))}
      </BarChart>
    );
  }
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>{chart}</ResponsiveContainer>
    </div>
  );
}
