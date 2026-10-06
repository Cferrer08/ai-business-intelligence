import type { Metadata } from "next";
import { Wordmark } from "@/components/Wordmark";
import { ReportBody } from "@/components/reports/ReportBody";
import { getSharedReport } from "@/lib/server/reportAccess";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Shared report", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await getSharedReport(token);
  if (!row) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <Wordmark />
        <h1 className="mt-10 text-2xl font-bold">This link isn&apos;t available</h1>
        <p className="mt-2 text-ink-soft">The link is wrong, or sharing was turned off for this report.</p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Wordmark />
        <a href={`/r/${token}/pdf`} className="rounded bg-signal px-3 py-1.5 text-sm font-semibold text-white hover:bg-signal-hover">Download PDF</a>
      </div>
      <h1 className="mt-8 text-3xl font-bold tracking-tight">{row.report.title}</h1>
      <p className="mt-1 text-ink-soft">Shared report. Dataset: {row.content.datasetName}. Generated {formatDate(row.report.createdAt, true)}{row.author ? ` by ${row.author}` : ""}. Read-only.</p>
      <div className="mt-8"><ReportBody content={row.content} /></div>
    </main>
  );
}
