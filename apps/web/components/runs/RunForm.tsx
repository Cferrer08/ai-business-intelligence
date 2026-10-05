"use client";

import { useActionState, useMemo, useState } from "react";
import { runModel, type RunState } from "@/app/actions/runs";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { RunKind } from "@/lib/server/runs";

export interface DatasetColumns {
  id: string;
  name: string;
  columns: { name: string; type: string; role: string }[];
}

const sel = "mt-1 block w-full rounded border border-line bg-paper-raised px-2.5 py-2 text-sm";
const label = "block text-sm font-medium";

export function RunForm({ kind, datasets }: { kind: RunKind; datasets: DatasetColumns[] }) {
  const action = useMemo(() => runModel.bind(null, kind), [kind]);
  const [state, formAction] = useActionState<RunState, FormData>(action, null);
  const v = state && !state.ok ? state.values ?? {} : {};
  const [datasetId, setDatasetId] = useState(v.datasetId ?? datasets[0]?.id ?? "");
  const [scope, setScope] = useState(v.scope ?? "time");
  const ds = datasets.find((d) => d.id === datasetId) ?? datasets[0];
  const numeric = ds?.columns.filter((c) => c.type === "numeric" && ["monetary", "quantity", "metric"].includes(c.role)) ?? [];
  const dates = ds?.columns.filter((c) => c.type === "datetime") ?? [];
  const groups = ds?.columns.filter((c) => ["categorical", "identifier"].includes(c.type) && c.role !== "text") ?? [];
  const preferred = numeric.find((c) => c.role === "monetary") ?? numeric[0];

  if (!ds) return <p className="text-sm text-ink-soft">Upload a dataset first.</p>;
  const needsTime = kind === "forecast" || kind === "trend" || (kind === "anomalies" && scope !== "records");
  if (needsTime && dates.length === 0) {
    return (
      <form className="space-y-3">
        <DatasetPicker datasets={datasets} value={ds.id} onChange={setDatasetId} />
        <p className="text-sm text-ink-soft">This dataset has no date column, which this analysis needs.</p>
      </form>
    );
  }

  return (
    <form action={formAction} className="space-y-4" key={ds.id}>
      <DatasetPicker datasets={datasets} value={ds.id} onChange={setDatasetId} />
      {kind === "anomalies" ? (
        <label className={label}>Look for
          <select name="scope" value={scope} onChange={(e) => setScope(e.target.value)} className={sel}>
            <option value="time">Unusual days, weeks or months</option>
            <option value="groups">Groups with an unusual latest period</option>
            <option value="records">Unusual individual rows</option>
          </select>
        </label>
      ) : null}
      {kind === "forecast" || kind === "trend" || (kind === "anomalies" && scope !== "records") ? (
        <>
          <label className={label}>Measure
            <select name="metric" defaultValue={v.metric ?? preferred?.name ?? "__rows"} className={sel}>
              {numeric.map((c) => <option key={c.name} value={c.name}>{c.name} (total)</option>)}
              <option value="__rows">Number of rows</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>Date column
              <select name="date" defaultValue={v.date ?? dates[0]?.name} className={sel}>{dates.map((c) => <option key={c.name}>{c.name}</option>)}</select>
            </label>
            <label className={label}>Per
              <select name="grain" defaultValue={v.grain ?? "auto"} className={sel}>
                <option value="auto">Automatic</option><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option>
              </select>
            </label>
          </div>
        </>
      ) : null}
      {kind === "anomalies" && scope === "records" ? (
        <label className={label}>Column to check
          <select name="metric" defaultValue={v.metric ?? ""} className={sel}>
            <option value="">All numeric columns</option>
            {numeric.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </label>
      ) : null}
      {kind === "anomalies" && scope === "groups" ? (
        <label className={label}>Grouping
          <select name="dimension" defaultValue={v.dimension} className={sel}>{groups.map((c) => <option key={c.name}>{c.name}</option>)}</select>
        </label>
      ) : null}
      {kind === "anomalies" ? (
        <label className={label}>Sensitivity
          <select name="sensitivity" defaultValue={v.sensitivity ?? "normal"} className={sel}>
            <option value="low">Low: only the most extreme</option><option value="normal">Normal</option><option value="high">High: flag more</option>
          </select>
        </label>
      ) : null}
      {kind === "forecast" ? (
        <label className={label}>Periods ahead
          <input name="horizon" type="number" min={1} max={104} defaultValue={v.horizon ?? 6} className={sel} />
        </label>
      ) : null}
      {kind === "correlation" ? (
        <>
          <fieldset>
            <legend className={label}>Measures to compare <span className="font-normal text-ink-muted">(none selected: all)</span></legend>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {ds.columns.filter((c) => c.type === "numeric").map((c) => (
                <label key={c.name} className="flex items-center gap-2 text-sm"><input type="checkbox" name="columns" value={c.name} />{c.name}</label>
              ))}
            </div>
          </fieldset>
          <label className={label}>Compare
            <select name="grain" defaultValue={v.grain ?? "none"} className={sel}>
              <option value="none">Row by row</option><option value="day">Daily totals</option><option value="week">Weekly totals</option><option value="month">Monthly totals</option>
            </select>
          </label>
        </>
      ) : null}
      {kind === "segmentation" ? (
        <p className="text-sm text-ink-soft">Uses the customer id, date and revenue columns recognised in the dataset.</p>
      ) : null}
      {state && !state.ok ? <p role="alert" className="rounded border border-down/30 bg-down/5 px-3 py-2 text-sm text-down">{state.error}</p> : null}
      <SubmitButton pendingLabel="Running…">Run</SubmitButton>
    </form>
  );
}

function DatasetPicker({ datasets, value, onChange }: { datasets: DatasetColumns[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className={label}>Dataset
      <select name="datasetId" value={value} onChange={(e) => onChange(e.target.value)} className={sel}>
        {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
  );
}
