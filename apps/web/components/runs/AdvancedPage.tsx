import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { EngineResult } from "@insight/ai";
import { PageHeader } from "@/components/app/PageHeader";
import { RunForm, type DatasetColumns } from "./RunForm";
import { RunResult } from "./RunResult";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";
import { getDatasetProfile, listDatasets } from "@/lib/server/datasets";
import { getRun, listRuns, type RunKind } from "@/lib/server/runs";
import { formatDate } from "@/lib/format";

type Page = "forecasts" | "anomalies" | "analytics";
const TABS: { kind: RunKind; label: string }[] = [
  { kind: "correlation", label: "Correlation" }, { kind: "segmentation", label: "Customer segments" }, { kind: "trend", label: "Trend" },
];

export async function AdvancedPage({ page, title, description, searchParams }: {
  page: Page; title: string; description: string; searchParams: Promise<{ run?: string; tab?: string }>;
}) {
  const { workspace } = await requireWorkspace();
  const { run: runParam, tab } = await searchParams;
  const kind: RunKind = page === "forecasts" ? "forecast" : page === "anomalies" ? "anomalies" : (TABS.find((t) => t.kind === tab)?.kind ?? "correlation");

  const ready = (await listDatasets(workspace.id)).filter((d) => d.status === "ready").slice(0, 30);
  const datasets: DatasetColumns[] = (await Promise.all(ready.map(async (d) => {
    const p = await getDatasetProfile(workspace.id, d.id);
    return p ? { id: d.id, name: d.name, columns: p.profile.columns.map((c) => ({ name: c.name, type: c.logical_type, role: c.role.role })) } : null;
  }))).filter(Boolean) as DatasetColumns[];

  const runs = await listRuns(workspace.id, page);
  const id = runParam ? z.string().uuid().safeParse(runParam) : null;
  if (id && !id.success) notFound();
  const selectedId = id?.data ?? runs.find((r) => r.kind === kind)?.id;
  const selected = selectedId ? await getRun(workspace.id, page, selectedId) : null;
  if (id?.success && !selected) notFound();
  const canRun = roleAtLeast(workspace.role, "MEMBER");

  return (
    <>
      <PageHeader title={title} description={description} />
      {page === "analytics" ? (
        <nav aria-label="Analysis type" className="flex gap-1 border-b border-line px-6 lg:px-10">
          {TABS.map((t) => (
            <Link key={t.kind} href={`/analytics?tab=${t.kind}`} aria-current={kind === t.kind ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm ${kind === t.kind ? "border-signal font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>{t.label}</Link>
          ))}
        </nav>
      ) : null}
      <div className="grid gap-8 px-6 py-8 lg:grid-cols-[320px_1fr] lg:px-10">
        <div className="space-y-8">
          <section aria-labelledby="new-run" className="rounded-lg border border-line bg-paper-raised p-5">
            <h2 id="new-run" className="mb-4 font-semibold">New {kind === "forecast" ? "forecast" : kind === "anomalies" ? "check" : TABS.find((t) => t.kind === kind)?.label.toLowerCase()}</h2>
            {datasets.length === 0 ? (
              <p className="text-sm text-ink-soft">Upload a dataset on the <Link href="/data" className="text-signal hover:underline">Data</Link> page first.</p>
            ) : canRun ? <RunForm kind={kind} datasets={datasets} /> : <p className="text-sm text-ink-soft">Viewers can see results but not run new ones.</p>}
          </section>
          <section aria-labelledby="history">
            <h2 id="history" className="mb-2 text-sm font-semibold text-ink-soft">History</h2>
            {runs.length === 0 ? <p className="text-sm text-ink-muted">No runs yet.</p> : (
              <ul className="space-y-px">
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link href={`/${page}?run=${r.id}${page === "analytics" ? `&tab=${r.kind}` : ""}`} aria-current={r.id === selected?.run.id ? "page" : undefined}
                      className={`block rounded-sm px-3 py-2 ${r.id === selected?.run.id ? "bg-paper-raised shadow-[inset_3px_0_0_#1D5FBF]" : "hover:bg-paper-raised/70"}`}>
                      <span className="block text-sm">{r.title}</span>
                      <span className="block text-xs text-ink-muted">{r.datasetName} · {formatDate(r.createdAt, true)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="min-w-0">
          {selected ? (
            <RunResult title={selected.run.title} result={selected.run.result as EngineResult} datasetName={selected.datasetName} createdAt={selected.run.createdAt.toISOString()} />
          ) : (
            <div className="rounded-lg border border-dashed border-line px-6 py-10 text-ink-soft">Choose options and run to see results here. You can also ask the AI Analyst in plain English.</div>
          )}
        </div>
      </div>
    </>
  );
}
