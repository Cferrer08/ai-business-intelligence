"use client";

import { useActionState, useEffect, useState } from "react";
import { createWorkflow, type WorkflowState } from "@/app/actions/workflows";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { hourLabel } from "@/lib/workflows/schedule";

interface DS { id: string; name: string; columns: { name: string; type: string }[] }
const sel = "mt-1 block w-full rounded border border-line bg-paper-raised px-2.5 py-2 text-sm";
const lbl = "block text-sm font-medium";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TYPES = [
  ["briefing", "Business briefing", "Latest day, week or month vs the one before, with the biggest movers and anything unusual."],
  ["weekly_review", "Weekly business review", "The weekly briefing plus a full business report, every week."],
  ["report", "Scheduled report", "A full business report on a schedule."],
  ["alert", "Alert", "Notify me when a measure drops or rises sharply, something unusual happens, or rows meet a condition."],
] as const;

export function WorkflowForm({ datasets }: { datasets: DS[] }) {
  const [state, action] = useActionState<WorkflowState, FormData>(createWorkflow, null);
  const v = state && !state.ok ? state.values ?? {} : {};
  const [type, setType] = useState(v.type ?? "briefing");
  const [frequency, setFrequency] = useState(v.frequency ?? "daily");
  const [mode, setMode] = useState(v.alertMode ?? "change");
  const [datasetId, setDatasetId] = useState(v.datasetId ?? datasets[0]?.id);
  const [tz, setTz] = useState(v.timezone ?? "UTC");
  useEffect(() => { if (!v.timezone) setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"); }, [v.timezone]);
  const ds = datasets.find((d) => d.id === datasetId) ?? datasets[0];
  const numeric = ds?.columns.filter((c) => c.type === "numeric") ?? [];
  const labels = ds?.columns.filter((c) => ["identifier", "categorical", "text"].includes(c.type)) ?? [];
  const freq = type === "weekly_review" ? "weekly" : frequency;

  return (
    <form action={action} className="space-y-4">
      <fieldset>
        <legend className={lbl}>Type</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {TYPES.map(([key, title, desc]) => (
            <label key={key} className={`cursor-pointer rounded border px-3 py-2 text-sm ${type === key ? "border-signal bg-signal-tint/40" : "border-line bg-paper-raised"}`}>
              <input type="radio" name="type" value={key} checked={type === key} onChange={() => setType(key)} className="sr-only" />
              <span className="font-medium">{title}</span>
              <span className="block text-xs text-ink-soft">{desc}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={lbl}>Name<input name="name" defaultValue={v.name ?? ""} maxLength={120} required placeholder="Morning briefing" className={sel} /></label>
        <label className={lbl}>Dataset
          <select name="datasetId" value={datasetId} onChange={(e) => setDatasetId(e.target.value)} className={sel}>{datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className={lbl}>How often
          <select name="frequency" value={freq} disabled={type === "weekly_review"} onChange={(e) => setFrequency(e.target.value)} className={sel}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </select>
          {type === "weekly_review" ? <input type="hidden" name="frequency" value="weekly" /> : null}
        </label>
        {freq === "weekly" ? (
          <label className={lbl}>Day<select name="weekday" defaultValue={v.weekday ?? "1"} className={sel}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
        ) : freq === "monthly" ? (
          <label className={lbl}>Day of month<select name="dayOfMonth" defaultValue={v.dayOfMonth ?? "1"} className={sel}>{Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
        ) : <div />}
        <label className={lbl}>Time<select name="hour" defaultValue={v.hour ?? "8"} className={sel}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select></label>
        <label className={lbl}>Time zone<input name="timezone" value={tz} onChange={(e) => setTz(e.target.value)} className={sel} /></label>
      </div>
      {type === "alert" ? (
        <div className="space-y-3 rounded border border-line bg-paper px-4 py-3">
          <label className={lbl}>Alert when
            <select name="alertMode" value={mode} onChange={(e) => setMode(e.target.value)} className={sel}>
              <option value="change">A measure changes sharply vs the previous period</option>
              <option value="anomaly">Something unusual happens in the latest period</option>
              <option value="rows">Rows meet a condition (e.g. stock below reorder point)</option>
            </select>
          </label>
          {mode === "change" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={lbl}>Measure<select name="metric" defaultValue={v.metric ?? "value"} className={sel}><option value="value">Revenue</option><option value="orders">Orders</option><option value="aov">Average order value</option></select></label>
              <label className={lbl}>Direction<select name="direction" defaultValue={v.direction ?? "down"} className={sel}><option value="down">Falls by</option><option value="up">Rises by</option></select></label>
              <label className={lbl}>At least (%)<input name="thresholdPct" type="number" min={1} max={500} defaultValue={v.thresholdPct ?? "10"} className={sel} /></label>
            </div>
          ) : mode === "rows" ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <label className={lbl}>Column<select name="column" defaultValue={v.column} className={sel}>{numeric.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
              <label className={lbl}>Is<select name="op" defaultValue={v.op ?? "lt"} className={sel}><option value="lt">below</option><option value="lte">at or below</option><option value="gt">above</option><option value="gte">at or above</option></select></label>
              <label className={lbl}>Compared with column<select name="valueColumn" defaultValue={v.valueColumn ?? ""} className={sel}><option value="">(a fixed value)</option>{numeric.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
              <label className={lbl}>Or value<input name="value" type="number" step="any" defaultValue={v.value ?? ""} className={sel} /></label>
              <label className={`${lbl} sm:col-span-2`}>Show with<select name="labelColumn" defaultValue={v.labelColumn ?? ""} className={sel}><option value="">(nothing)</option>{labels.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
            </div>
          ) : null}
        </div>
      ) : null}
      {state && !state.ok ? <p role="alert" className="rounded border border-down/30 bg-down/5 px-3 py-2 text-sm text-down">{state.error}</p> : null}
      <SubmitButton pendingLabel="Saving…">Create workflow</SubmitButton>
    </form>
  );
}
