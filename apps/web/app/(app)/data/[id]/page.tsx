import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/app/PageHeader";
import { DeleteDatasetButton } from "@/components/data/DeleteDatasetButton";
import { qualityTone } from "@/components/data/QualityBadge";
import { columnSummary, roleLabel, typeLabel } from "@/components/data/columnSummary";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";
import { getDataset, getDatasetProfile } from "@/lib/server/datasets";
import { formatBytes, formatDate, formatInt, formatNumber, formatPct } from "@/lib/format";

export const metadata: Metadata = { title: "Dataset" };

function cell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T00:00:00$/.test(s) ? s.slice(0, 10) : s.replace("T", " ");
}

export default async function DatasetPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireWorkspace();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const dataset = await getDataset(workspace.id, id.data);
  if (!dataset) notFound();

  const canDelete = roleAtLeast(workspace.role, "MEMBER");
  const header = (
    <PageHeader
      title={dataset.name}
      description={`${dataset.originalFilename}, ${formatBytes(dataset.sizeBytes)}. Uploaded ${formatDate(dataset.createdAt, true)}.`}
      actions={canDelete ? <DeleteDatasetButton datasetId={dataset.id} name={dataset.name} /> : undefined}
    />
  );

  if (dataset.status !== "ready") {
    return (
      <>
        {header}
        <div className="px-6 py-8 lg:px-10">
          <div className="max-w-xl rounded-lg border border-line bg-paper-raised px-6 py-5">
            {dataset.status === "failed" ? (
              <>
                <p className="font-semibold text-down">This file couldn&apos;t be processed</p>
                <p className="mt-2 text-ink-soft">{dataset.errorMessage ?? "Something went wrong while processing the file."}</p>
                <Link href="/data" className="mt-4 inline-block text-sm font-semibold text-signal hover:underline">Upload a corrected file</Link>
              </>
            ) : (
              <p className="text-ink-soft">This file is still being processed. Refresh in a moment.</p>
            )}
          </div>
        </div>
      </>
    );
  }

  const stored = await getDatasetProfile(workspace.id, dataset.id);
  if (!stored) notFound();
  const { profile: p, readNotes } = stored;
  const types = p.type_counts;
  const conversions = p.columns.filter((c) => c.converted_from);

  const summary: [string, string][] = [
    ["Rows", formatInt(p.row_count)],
    ["Columns", formatInt(p.column_count)],
    ["Numeric", formatInt(types.numeric ?? 0)],
    ["Categorical", formatInt((types.categorical ?? 0) + (types.text ?? 0) + (types.boolean ?? 0))],
    ["Date", formatInt(types.datetime ?? 0)],
    ["IDs", formatInt(types.identifier ?? 0)],
    ["Missing values", formatPct(p.missing_pct)],
    ["Duplicate rows", formatInt(p.duplicate_rows)],
  ];

  return (
    <>
      {header}
      <div className="space-y-10 px-6 py-8 lg:px-10">
        <section aria-labelledby="profile" className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <h2 id="profile" className="text-lg font-semibold">Dataset profile</h2>
            <dl className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-paper-raised sm:grid-cols-4">
              {summary.map(([label, value]) => (
                <div key={label} className="border-b border-r border-line px-5 py-4 [&:nth-child(2n)]:border-r-0 sm:[&:nth-child(2n)]:border-r sm:[&:nth-child(4n)]:border-r-0 [&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-last-child(-n+4)]:border-b-0">
                  <dt className="text-sm text-ink-muted">{label}</dt>
                  <dd className="num mt-1 text-xl font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h2 className="text-lg font-semibold">Quality score</h2>
            <div className="mt-4 rounded-lg border border-line bg-paper-raised px-5 py-4">
              <p className="flex items-baseline gap-1">
                <span className={`num text-3xl font-bold ${qualityTone(p.quality.score)}`}>{p.quality.score}</span>
                <span className="text-ink-muted">/ 100</span>
              </p>
              {p.quality.breakdown.length === 0 ? (
                <p className="mt-2 text-sm text-ink-soft">No missing values, duplicates or unreadable values found.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {p.quality.breakdown.map((b) => (
                    <li key={b.factor} className="flex justify-between gap-3">
                      <span className="text-ink-soft">{b.detail}</span>
                      <span className="num shrink-0 font-medium text-down">−{b.penalty}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        {readNotes.length + conversions.length + p.warnings.length > 0 ? (
          <section aria-labelledby="notes" className="grid gap-6 lg:grid-cols-2">
            {readNotes.length + conversions.length > 0 ? (
              <div>
                <h2 id="notes" className="text-lg font-semibold">How the file was read</h2>
                <ul className="mt-4 space-y-2 rounded-lg border border-line bg-paper-raised px-5 py-4 text-sm text-ink-soft">
                  {readNotes.map((n) => <li key={n}>{n}</li>)}
                  {conversions.map((c) => (
                    <li key={c.name}><span className="font-medium text-ink">{c.name}</span>: converted from {c.converted_from}.</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {p.warnings.length > 0 ? (
              <div>
                <h2 className="text-lg font-semibold">Worth checking</h2>
                <ul className="mt-4 space-y-2 rounded-lg border border-line bg-paper-raised px-5 py-4 text-sm">
                  {p.warnings.map((w, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className={w.level === "warning" ? "text-caution" : "text-ink-muted"}>{w.level === "warning" ? "▲" : "●"}</span>
                      <span className="text-ink-soft">{w.column ? <span className="font-medium text-ink">{w.column}: </span> : null}{w.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="columns">
          <h2 id="columns" className="text-lg font-semibold">Columns</h2>
          <p className="mt-1 text-sm text-ink-soft">Roles are suggested from column names and kept only when the values agree.</p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-paper-raised">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-line text-ink-muted">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Column</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Type</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Role</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Missing</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Distinct</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Values</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {p.columns.map((c) => (
                  <tr key={c.name}>
                    <td className="px-5 py-3 font-medium">{c.name}</td>
                    <td className="px-5 py-3 text-ink-soft">{typeLabel(c)}</td>
                    <td className="px-5 py-3" title={c.role.evidence.join("; ")}>
                      {roleLabel(c)}
                      {c.role.confidence !== "high" ? <span className="text-ink-muted"> ({c.role.confidence})</span> : null}
                    </td>
                    <td className={`num px-5 py-3 text-right ${c.missing_pct >= 20 ? "text-caution" : ""}`}>{c.missing_count ? formatPct(c.missing_pct) : "—"}</td>
                    <td className="num px-5 py-3 text-right">{formatInt(c.unique_count)}</td>
                    <td className="num px-5 py-3 text-ink-soft">{columnSummary(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {p.correlations.length > 0 ? (
          <section aria-labelledby="relationships">
            <h2 id="relationships" className="text-lg font-semibold">Strong relationships</h2>
            <p className="mt-1 text-sm text-ink-soft">Columns that rise and fall together. This shows association, not cause.</p>
            <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-paper-raised text-sm">
              {p.correlations.map((r) => (
                <li key={`${r.a}-${r.b}`} className="flex justify-between gap-4 px-5 py-3">
                  <span><span className="font-medium">{r.a}</span> and <span className="font-medium">{r.b}</span> move {r.direction === "positive" ? "together" : "in opposite directions"}</span>
                  <span className="num text-ink-soft">rank correlation {r.spearman.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="preview">
          <h2 id="preview" className="text-lg font-semibold">First {p.preview.rows.length} rows</h2>
          <div className="mt-4 max-h-[480px] overflow-auto rounded-lg border border-line bg-paper-raised">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-line bg-paper-raised text-ink-muted">
                <tr>{p.preview.columns.map((c) => <th key={c} scope="col" className="whitespace-nowrap px-4 py-2 font-medium">{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {p.preview.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => (
                      <td key={j} className={`num max-w-[240px] truncate whitespace-nowrap px-4 py-2 ${typeof v === "number" ? "text-right" : ""} ${v == null ? "bg-paper" : ""}`}>{cell(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
