import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { and, datasets, db, desc, eq, isNull, workflowExecutions, workflows } from "@insight/database";
import type { EngineResult, ReportSummary } from "@insight/ai";
import { PageHeader } from "@/components/app/PageHeader";
import { BriefingView } from "@/components/workflows/BriefingView";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { deleteWorkflow, runNow, toggleWorkflow } from "@/app/actions/workflows";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";
import { describeSchedule, formatInZone } from "@/lib/workflows/schedule";

export const metadata: Metadata = { title: "Workflow" };
const STATUS: Record<string, string> = { succeeded: "text-up", failed: "text-down", running: "text-caution", skipped: "text-ink-muted" };

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireWorkspace();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [row] = await db.select({ w: workflows, datasetName: datasets.name }).from(workflows).innerJoin(datasets, eq(datasets.id, workflows.datasetId))
    .where(and(eq(workflows.id, id.data), eq(workflows.workspaceId, workspace.id), isNull(workflows.deletedAt))).limit(1);
  if (!row) notFound();
  const w = row.w;
  const runs = await db.select().from(workflowExecutions).where(and(eq(workflowExecutions.workflowId, w.id), eq(workflowExecutions.workspaceId, workspace.id)))
    .orderBy(desc(workflowExecutions.startedAt)).limit(20);
  const latest = runs.find((r) => r.status === "succeeded");
  const out = latest?.output as { briefing?: EngineResult & Record<string, any>; summary?: ReportSummary; reportId?: string; reportTitle?: string; triggered?: boolean; detail?: string; notified?: boolean; alert?: any } | undefined;
  const canEdit = roleAtLeast(workspace.role, "MEMBER");
  const hidden = <input type="hidden" name="workflowId" value={w.id} />;
  return (
    <>
      <PageHeader title={w.name} description={`${describeSchedule(w)} (${w.timezone}) · ${row.datasetName} · ${w.enabled ? `Next run ${formatInZone(w.nextRunAt, w.timezone)}` : "Paused"}`}
        actions={canEdit ? (
          <div className="flex flex-wrap gap-2">
            <form action={runNow}>{hidden}<SubmitButton pendingLabel="Running…">Run now</SubmitButton></form>
            <form action={toggleWorkflow}>{hidden}<SubmitButton pendingLabel="Saving…" className="!bg-paper-raised !text-ink border border-line">{w.enabled ? "Pause" : "Resume"}</SubmitButton></form>
            <form action={deleteWorkflow}>{hidden}<SubmitButton pendingLabel="Deleting…" className="!bg-paper-raised !text-down border border-line">Delete</SubmitButton></form>
          </div>
        ) : undefined} />
      <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1fr_340px] lg:px-10">
        <section aria-labelledby="latest" className="min-w-0">
          <h2 id="latest" className="mb-3 text-lg font-semibold">Latest result</h2>
          {!latest ? <p className="rounded-lg border border-dashed border-line px-5 py-6 text-ink-soft">No successful run yet. Use &quot;Run now&quot; to try it.</p> : (
            <div className="space-y-4 rounded-lg border border-line bg-paper-raised p-5">
              {out?.briefing && out.summary ? <BriefingView briefing={out.briefing} summary={out.summary} /> : null}
              {out?.triggered !== undefined ? (
                <div className={`rounded px-4 py-3 ${out.triggered ? "border border-down/30 bg-down/5" : "border border-line bg-paper"}`}>
                  <p className="font-semibold">{out.triggered ? "Alert triggered" : "No alert"}</p>
                  <p className="mt-1 text-sm text-ink-soft">{out.detail}</p>
                  {out.triggered && !out.notified ? <p className="mt-1 text-xs text-ink-muted">Same result as the previous run, so no new notification was sent.</p> : null}
                  {out.alert?.rows?.length ? (
                    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-ink-muted"><tr>{out.alert.columns.map((c: string) => <th key={c} className="py-1 pr-4 font-medium">{c}</th>)}</tr></thead>
                      <tbody>{out.alert.rows.map((r: any, i: number) => <tr key={i} className="border-t border-line">{out.alert.columns.map((c: string) => <td key={c} className="num py-1 pr-4">{String(r[c] ?? "")}</td>)}</tr>)}</tbody></table></div>
                  ) : null}
                </div>
              ) : null}
              {out?.reportId ? <Link href={`/reports/${out.reportId}`} className="inline-block text-sm font-semibold text-signal hover:underline">Open the report: {out.reportTitle}</Link> : null}
            </div>
          )}
        </section>
        <section aria-labelledby="runs">
          <h2 id="runs" className="mb-3 text-lg font-semibold">Runs</h2>
          {w.consecutiveFailures >= 5 && !w.enabled ? <p className="mb-3 rounded border border-caution/30 bg-caution/5 px-3 py-2 text-sm text-caution">Paused after repeated failures. Fix the cause, then Resume.</p> : null}
          {runs.length === 0 ? <p className="text-sm text-ink-muted">No runs yet.</p> : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-paper-raised text-sm">
              {runs.map((r) => (
                <li key={r.id} className="px-4 py-2.5">
                  <span className={`font-medium ${STATUS[r.status]}`}>{r.status[0].toUpperCase() + r.status.slice(1)}</span>
                  <span className="text-ink-muted"> · {r.trigger === "manual" ? "Run now" : "Scheduled"} · {formatInZone(r.startedAt, w.timezone)}</span>
                  {r.errorMessage ? <p className="text-xs text-down">{r.errorMessage}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
