import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/PageHeader";
import { Uploader } from "@/components/data/Uploader";
import { QualityBadge } from "@/components/data/QualityBadge";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";
import { listDatasets } from "@/lib/server/datasets";
import { formatBytes, formatDate, formatInt } from "@/lib/format";

export const metadata: Metadata = { title: "Data" };

const STATUS: Record<string, { label: string; className: string }> = {
  ready: { label: "Ready", className: "text-up" },
  processing: { label: "Processing", className: "text-caution" },
  failed: { label: "Failed", className: "text-down" },
};

export default async function DataPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { workspace } = await requireWorkspace();
  const { deleted } = await searchParams;
  const rows = await listDatasets(workspace.id);
  const canUpload = roleAtLeast(workspace.role, "MEMBER");

  return (
    <>
      <PageHeader title="Data" description="Upload a file and every column is checked, typed and profiled. The original file is kept unchanged." />
      <div className="space-y-8 px-6 py-8 lg:px-10">
        {deleted ? <p role="status" className="text-sm text-ink-soft">Dataset deleted.</p> : null}
        {canUpload ? <Uploader /> : <p className="text-sm text-ink-soft">Viewers can browse datasets but not upload them.</p>}

        <section aria-labelledby="datasets">
          <h2 id="datasets" className="text-lg font-semibold">Datasets</h2>
          {rows.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-line px-5 py-6 text-ink-soft">
              No datasets yet. Upload a sales, customer or inventory export to get started.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-paper-raised">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-line text-ink-muted">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">Name</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Rows</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Columns</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Quality</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Status</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Uploaded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((d) => (
                    <tr key={d.id} className="hover:bg-paper">
                      <td className="px-5 py-3">
                        <Link href={`/data/${d.id}`} className="font-medium text-ink hover:text-signal hover:underline">{d.name}</Link>
                        <p className="text-xs text-ink-muted">{d.fileFormat.toUpperCase()}, {formatBytes(d.sizeBytes)}</p>
                      </td>
                      <td className="num px-5 py-3 text-right">{formatInt(d.rowCount)}</td>
                      <td className="num px-5 py-3 text-right">{formatInt(d.columnCount)}</td>
                      <td className="px-5 py-3 text-right"><QualityBadge score={d.qualityScore} /></td>
                      <td className={`px-5 py-3 ${STATUS[d.status].className}`}>{STATUS[d.status].label}</td>
                      <td className="num px-5 py-3 text-ink-soft">{formatDate(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
