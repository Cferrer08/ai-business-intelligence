import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { and, asc, db, documentChunks, documents, eq, isNull } from "@insight/database";
import { pageLabel } from "@insight/ai";
import { PageHeader } from "@/components/app/PageHeader";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";
import { deleteDocument } from "@/app/actions/documents";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { formatBytes, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Document" };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireWorkspace();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [doc] = await db.select().from(documents)
    .where(and(eq(documents.id, id.data), eq(documents.workspaceId, workspace.id), isNull(documents.deletedAt))).limit(1);
  if (!doc) notFound();
  const chunks = await db.select().from(documentChunks)
    .where(and(eq(documentChunks.documentId, doc.id), eq(documentChunks.workspaceId, workspace.id))).orderBy(asc(documentChunks.chunkIndex));
  const warnings = doc.warnings as string[];
  return (
    <>
      <PageHeader title={doc.name} description={`${doc.originalFilename}, ${formatBytes(doc.sizeBytes)}${doc.pages ? `, ${doc.pages} pages` : ""}. Uploaded ${formatDate(doc.createdAt, true)}.`}
        actions={roleAtLeast(workspace.role, "MEMBER") ? (
          <form action={deleteDocument}>
            <input type="hidden" name="documentId" value={doc.id} />
            <SubmitButton pendingLabel="Deleting…" className="!bg-paper-raised !text-down border border-line hover:!bg-down/5">Delete document</SubmitButton>
          </form>
        ) : undefined} />
      <div className="max-w-4xl space-y-6 px-6 py-8 lg:px-10">
        {doc.status === "failed" ? (
          <div className="rounded-lg border border-down/30 bg-down/5 px-5 py-4">
            <p className="font-semibold text-down">This document couldn&apos;t be indexed</p>
            <p className="mt-1 text-ink-soft">{doc.errorMessage}</p>
            <Link href="/knowledge" className="mt-3 inline-block text-sm font-semibold text-signal hover:underline">Upload a corrected file</Link>
          </div>
        ) : null}
        {warnings.length ? (
          <ul className="space-y-1 rounded-lg border border-caution/30 bg-caution/5 px-5 py-3 text-sm text-caution">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        ) : null}
        {chunks.length ? (
          <section aria-labelledby="passages">
            <h2 id="passages" className="text-lg font-semibold">{chunks.length} indexed passages</h2>
            <p className="mt-1 text-sm text-ink-soft">This is exactly the text the AI Analyst can cite. Flagged passages stay searchable but are never sent to the AI.</p>
            <ol className="mt-4 space-y-3">
              {chunks.map((c) => (
                <li key={c.id} className={`rounded-lg border px-4 py-3 ${c.flagged ? "border-caution/40 bg-caution/5" : "border-line bg-paper-raised"}`}>
                  <p className="text-xs text-ink-muted">Passage {c.chunkIndex + 1}{pageLabel(c.pageStart, c.pageEnd) ? `, ${pageLabel(c.pageStart, c.pageEnd)}` : ""}{c.heading ? ` · ${c.heading}` : ""}</p>
                  {c.flagged ? <p className="text-xs font-semibold text-caution">Flagged: reads like instructions to an AI</p> : null}
                  <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{c.text}</p>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </>
  );
}
