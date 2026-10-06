import type { Metadata } from "next";
import Link from "next/link";
import { and, datasets, db, desc, eq, isNull, reports } from "@insight/database";
import { PageHeader } from "@/components/app/PageHeader";
import { GenerateForm } from "@/components/reports/GenerateForm";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";
import { listDatasets } from "@/lib/server/datasets";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { workspace } = await requireWorkspace();
  const { deleted } = await searchParams;
  const ready = (await listDatasets(workspace.id)).filter((d) => d.status === "ready");
  const rows = await db.select({ r: reports, datasetName: datasets.name }).from(reports).innerJoin(datasets, eq(datasets.id, reports.datasetId))
    .where(and(eq(reports.workspaceId, workspace.id), isNull(reports.deletedAt))).orderBy(desc(reports.createdAt)).limit(50);
  return (
    <>
      <PageHeader title="Reports" description="A full business report from one dataset: key figures, trends, what changed, products, regions, customers, anomalies, a forecast, risks and recommended actions." />
      <div className="space-y-8 px-6 py-8 lg:px-10">
        {deleted ? <p role="status" className="text-sm text-ink-soft">Report deleted.</p> : null}
        {ready.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-5 py-6 text-ink-soft">Upload a dataset on the <Link href="/data" className="text-signal hover:underline">Data</Link> page first.</p>
        ) : roleAtLeast(workspace.role, "MEMBER") ? (
          <div className="rounded-lg border border-line bg-paper-raised p-5"><GenerateForm datasets={ready.map((d) => ({ id: d.id, name: d.name }))} /></div>
        ) : null}
        <section aria-labelledby="saved">
          <h2 id="saved" className="text-lg font-semibold">Saved reports</h2>
          {rows.length === 0 ? <p className="mt-3 text-sm text-ink-muted">No reports yet.</p> : (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-paper-raised">
              {rows.map(({ r, datasetName }) => (
                <li key={r.id}>
                  <Link href={`/reports/${r.id}`} className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-3 hover:bg-paper">
                    <span>
                      <span className="font-medium">{r.title}</span>
                      {r.shareTokenHash ? <span className="ml-2 rounded bg-signal-tint px-1.5 py-0.5 text-xs text-signal">Shared</span> : null}
                      {r.status === "failed" ? <span className="ml-2 text-xs text-down">Failed</span> : null}
                      <span className="block text-xs text-ink-muted">{datasetName}</span>
                    </span>
                    <time className="num text-sm text-ink-muted" dateTime={r.createdAt.toISOString()}>{formatDate(r.createdAt, true)}</time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
