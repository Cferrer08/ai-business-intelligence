import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/app/PageHeader";
import { ReportBody } from "@/components/reports/ReportBody";
import { ShareControls } from "@/components/reports/ShareControls";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { deleteReport } from "@/app/actions/reports";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";
import { getReport } from "@/lib/server/reportAccess";
import { formatDate } from "@/lib/format";
import type { ReportContent } from "@/lib/server/reports";

export const metadata: Metadata = { title: "Report" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireWorkspace();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const row = await getReport(workspace.id, id.data);
  if (!row) notFound();
  const r = row.report;
  const canEdit = roleAtLeast(workspace.role, "MEMBER");
  return (
    <>
      <PageHeader title={r.title} description={`Dataset: ${row.datasetName}. Generated ${formatDate(r.createdAt, true)}${row.author ? ` by ${row.author}` : ""}.`} />
      <div className="max-w-5xl space-y-6 px-6 py-8 lg:px-10">
        {r.status === "failed" ? <p className="rounded border border-down/30 bg-down/5 px-4 py-3 text-down">{r.errorMessage}</p> : null}
        {r.status === "ready" ? (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper-raised px-4 py-3 text-sm">
              <a href={`/api/reports/${r.id}/pdf`} className="rounded bg-signal px-3 py-1.5 font-semibold text-white hover:bg-signal-hover">Download PDF</a>
              <a href={`/api/reports/${r.id}/csv`} className="rounded border border-line bg-paper-raised px-3 py-1.5 hover:border-signal">Key figures (CSV)</a>
              <span className="flex-1" />
              {canEdit ? (
                <form action={deleteReport}>
                  <input type="hidden" name="reportId" value={r.id} />
                  <SubmitButton pendingLabel="Deleting…" className="!bg-paper-raised !text-down border border-line hover:!bg-down/5">Delete</SubmitButton>
                </form>
              ) : null}
              {canEdit ? <div className="w-full border-t border-line pt-3"><ShareControls reportId={r.id} shared={Boolean(r.shareTokenHash)} /></div> : null}
            </div>
            <ReportBody content={r.content as ReportContent} />
          </>
        ) : null}
      </div>
    </>
  );
}
