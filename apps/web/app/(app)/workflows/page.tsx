import type { Metadata } from "next";
import Link from "next/link";
import { and, datasets, db, desc, eq, isNull, workflows } from "@insight/database";
import { PageHeader } from "@/components/app/PageHeader";
import { WorkflowForm } from "@/components/workflows/WorkflowForm";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";
import { getDatasetProfile, listDatasets } from "@/lib/server/datasets";
import { describeSchedule, formatInZone } from "@/lib/workflows/schedule";

export const metadata: Metadata = { title: "Workflows" };
const TYPE: Record<string, string> = { briefing: "Briefing", weekly_review: "Weekly review", report: "Report", alert: "Alert" };

export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { workspace } = await requireWorkspace();
  const { deleted } = await searchParams;
  const ready = (await listDatasets(workspace.id)).filter((d) => d.status === "ready").slice(0, 30);
  const options = (await Promise.all(ready.map(async (d) => {
    const p = await getDatasetProfile(workspace.id, d.id);
    return { id: d.id, name: d.name, columns: p?.profile.columns.map((c) => ({ name: c.name, type: c.logical_type })) ?? [] };
  })));
  const rows = await db.select({ w: workflows, datasetName: datasets.name }).from(workflows).innerJoin(datasets, eq(datasets.id, workflows.datasetId))
    .where(and(eq(workflows.workspaceId, workspace.id), isNull(workflows.deletedAt))).orderBy(desc(workflows.createdAt));
  const cronOk = Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16);
  return (
    <>
      <PageHeader title="Workflows" description="Scheduled briefings, weekly reviews, reports and alerts. Results are saved and you're notified in the app." />
      <div className="space-y-8 px-6 py-8 lg:px-10">
        {!cronOk ? (
          <p className="max-w-3xl rounded border border-caution/30 bg-caution/5 px-4 py-3 text-sm text-caution">
            Scheduled runs need <code>CRON_SECRET</code> in <code>apps/web/.env.local</code> and the scheduler running (see the README). &quot;Run now&quot; works without it.
          </p>
        ) : null}
        {deleted ? <p role="status" className="text-sm text-ink-soft">Workflow deleted.</p> : null}
        <section aria-labelledby="list">
          <h2 id="list" className="text-lg font-semibold">Your workflows</h2>
          {rows.length === 0 ? <p className="mt-3 text-sm text-ink-muted">No workflows yet.</p> : (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-paper-raised">
              {rows.map(({ w, datasetName }) => (
                <li key={w.id}>
                  <Link href={`/workflows/${w.id}`} className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-3 hover:bg-paper">
                    <span>
                      <span className="font-medium">{w.name}</span>
                      <span className="ml-2 rounded bg-paper-sunk px-1.5 py-0.5 text-xs text-ink-soft">{TYPE[w.type]}</span>
                      {!w.enabled ? <span className="ml-2 text-xs text-caution">Paused</span> : null}
                      {w.lastStatus === "failed" ? <span className="ml-2 text-xs text-down">Last run failed</span> : null}
                      <span className="block text-xs text-ink-muted">{describeSchedule(w)} ({w.timezone}) · {datasetName}</span>
                    </span>
                    <span className="text-sm text-ink-muted">{w.enabled ? `Next: ${formatInZone(w.nextRunAt, w.timezone)}` : "Not scheduled"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        {roleAtLeast(workspace.role, "MEMBER") && options.length ? (
          <section aria-labelledby="new" className="max-w-3xl rounded-lg border border-line bg-paper-raised p-5">
            <h2 id="new" className="mb-4 text-lg font-semibold">New workflow</h2>
            <WorkflowForm datasets={options} />
          </section>
        ) : options.length === 0 ? <p className="text-sm text-ink-soft">Upload a dataset first.</p> : null}
      </div>
    </>
  );
}
