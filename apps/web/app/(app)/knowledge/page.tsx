import type { Metadata } from "next";
import Link from "next/link";
import { and, db, desc, documents, eq, isNull } from "@insight/database";
import { PageHeader } from "@/components/app/PageHeader";
import { KnowledgeUploader } from "@/components/knowledge/KnowledgeUploader";
import { KnowledgeSearch } from "@/components/knowledge/Search";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";
import { knowledgeConfigured } from "@/lib/server/knowledge";
import { formatBytes, formatDate, formatInt } from "@/lib/format";

export const metadata: Metadata = { title: "Knowledge" };

const STATUS: Record<string, [string, string]> = { ready: ["Ready", "text-up"], processing: ["Processing", "text-caution"], failed: ["Failed", "text-down"] };

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { workspace } = await requireWorkspace();
  const { deleted } = await searchParams;
  const cfg = knowledgeConfigured();
  const docs = await db.select().from(documents)
    .where(and(eq(documents.workspaceId, workspace.id), isNull(documents.deletedAt))).orderBy(desc(documents.createdAt));
  return (
    <>
      <PageHeader title="Knowledge" description="Upload policies, price lists and playbooks. The AI Analyst cites them alongside your data, and you can search them by meaning." />
      <div className="space-y-10 px-6 py-8 lg:px-10">
        {!cfg.ok ? (
          <div className="max-w-2xl rounded-lg border border-line bg-paper-raised px-6 py-5">
            <p className="font-semibold">The knowledge base needs to be configured</p>
            <p className="mt-2 text-ink-soft">Add {cfg.missing.map((m) => <code key={m} className="mx-0.5 rounded bg-paper-sunk px-1">{m}</code>)} to <code className="rounded bg-paper-sunk px-1">apps/web/.env.local</code> and restart the app. See the README for creating the Pinecone index.</p>
          </div>
        ) : (
          <>
            {deleted ? <p role="status" className="text-sm text-ink-soft">Document deleted and removed from search.</p> : null}
            {roleAtLeast(workspace.role, "MEMBER") ? <KnowledgeUploader /> : null}
            {docs.some((d) => d.status === "ready") ? (
              <section aria-labelledby="search"><h2 id="search" className="mb-3 text-lg font-semibold">Search</h2><KnowledgeSearch /></section>
            ) : null}
          </>
        )}
        <section aria-labelledby="docs">
          <h2 id="docs" className="text-lg font-semibold">Documents</h2>
          {docs.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-line px-5 py-6 text-ink-soft">No documents yet.</p> : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-paper-raised">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-line text-ink-muted">
                  <tr><th scope="col" className="px-5 py-2.5 font-medium">Name</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Pages</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Passages</th><th scope="col" className="px-5 py-2.5 font-medium">Status</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Uploaded</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {docs.map((d) => (
                    <tr key={d.id} className="hover:bg-paper">
                      <td className="px-5 py-3">
                        <Link href={`/knowledge/${d.id}`} className="font-medium text-ink hover:text-signal hover:underline">{d.name}</Link>
                        <p className="text-xs text-ink-muted">{d.fileFormat.toUpperCase()}, {formatBytes(d.sizeBytes)}{d.flaggedCount ? <span className="text-caution"> · {d.flaggedCount} flagged</span> : null}</p>
                      </td>
                      <td className="num px-5 py-3 text-right">{formatInt(d.pages)}</td>
                      <td className="num px-5 py-3 text-right">{formatInt(d.chunkCount)}</td>
                      <td className={`px-5 py-3 ${STATUS[d.status][1]}`}>{STATUS[d.status][0]}</td>
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
