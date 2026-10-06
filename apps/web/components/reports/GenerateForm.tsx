"use client";

import { useActionState } from "react";
import { generateReport, type ReportState } from "@/app/actions/reports";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function GenerateForm({ datasets }: { datasets: { id: string; name: string }[] }) {
  const [state, action] = useActionState<ReportState, FormData>(generateReport, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="block text-sm font-medium">Dataset
        <select name="datasetId" className="mt-1 block min-w-[240px] rounded border border-line bg-paper-raised px-2.5 py-2 text-sm">
          {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <SubmitButton pendingLabel="Generating report… (about 10–30 seconds)">Generate business report</SubmitButton>
      {state && !state.ok ? <p role="alert" className="w-full rounded border border-down/30 bg-down/5 px-3 py-2 text-sm text-down">{state.error}</p> : null}
    </form>
  );
}
