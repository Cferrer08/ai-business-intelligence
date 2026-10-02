import type { Metadata } from "next";
import Link from "next/link";
import { analysisRequests, and, auditLogs, count, db, desc, eq, inArray, users, workspaceMembers } from "@insight/database";
import { PageHeader } from "@/components/app/PageHeader";
import { KpiCards } from "@/components/charts/Chart";
import { MiniChart, PinnedChart, TrendChart } from "@/components/dashboard/DashboardCharts";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";
import { countDatasets, getDatasetProfile } from "@/lib/server/datasets";
import { dashboardDatasets, pinnedCharts, recentAnalyses } from "@/lib/server/dashboard";
import { dashboardData, type DashboardData } from "@/lib/server/engine";
import { formatDate, formatMetric } from "@/lib/format";
import { errorFields, logger } from "@/lib/server/logger";

export const metadata: Metadata = { title: "Dashboard" };

const ACTIVITY_LABEL: Record<string, string> = {
  "workspace.create": "created the workspace",
  "workspace.rename": "renamed the workspace",
  "dataset.upload": "uploaded a dataset",
  "dataset.delete": "deleted a dataset",
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string; dataset?: string }> }) {
  const { workspace, session } = await requireWorkspace();
  const { denied, dataset: requested } = await searchParams;

  const [[{ memberCount }], datasetCount, [{ analysisCount }], eligible, pins, recent, activity] = await Promise.all([
    db.select({ memberCount: count() }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspace.id)),
    countDatasets(workspace.id),
    db.select({ analysisCount: count() }).from(analysisRequests).where(and(eq(analysisRequests.workspaceId, workspace.id), eq(analysisRequests.status, "succeeded"))),
    dashboardDatasets(workspace.id),
    pinnedCharts(workspace.id),
    recentAnalyses(workspace.id),
    db.select({ id: auditLogs.id, action: auditLogs.action, createdAt: auditLogs.createdAt, user: { id: users.id, name: users.name } })
      .from(auditLogs).leftJoin(users, eq(users.id, auditLogs.userId))
      .where(and(eq(auditLogs.workspaceId, workspace.id), inArray(auditLogs.action, Object.keys(ACTIVITY_LABEL))))
      .orderBy(desc(auditLogs.createdAt)).limit(5),
  ]);

  // Overview: computed by the data engine from the selected dataset.
  const selected = eligible.find((d) => d.id === requested) ?? eligible[0];
  let overview: DashboardData | null = null;
  let overviewError = false;
  if (selected) {
    try {
      const stored = await getDatasetProfile(workspace.id, selected.id);
      if (stored) {
        const columns = stored.profile.columns.map((c) => ({ name: c.name, logical_type: c.logical_type, role: c.role.role, concept: c.role.concept }));
        overview = await dashboardData(workspace.id, selected.id, columns);
      }
    } catch (err) {
      overviewError = true;
      logger.error("dashboard.overview_failed", { datasetId: selected.id, ...errorFields(err) });
    }
  }
  const valueKpi = overview?.kpis.find((k) => k.key === "value");
  const checklist = [
    { label: "Upload your first dataset", done: datasetCount > 0, href: "/data" },
    { label: "Ask the analyst a question", done: analysisCount > 0, href: "/analyst" },
    { label: "Pin a chart to this dashboard", done: pins.length > 0, href: "/analyst" },
  ];
  const canEdit = roleAtLeast(workspace.role, "MEMBER");

  return (
    <>
      <PageHeader
        title={workspace.name}
        description={`${memberCount} ${memberCount === 1 ? "member" : "members"}, ${datasetCount} ${datasetCount === 1 ? "dataset" : "datasets"}.`}
        actions={eligible.length > 1 ? (
          <form className="flex items-center gap-2 text-sm text-ink-soft">
            <label htmlFor="dataset">Overview of</label>
            <select id="dataset" name="dataset" defaultValue={selected?.id} className="rounded border border-line bg-paper-raised px-2 py-1.5 text-ink">
              {eligible.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button type="submit" className="rounded border border-line bg-paper-raised px-2.5 py-1.5 text-ink hover:border-signal">Show</button>
          </form>
        ) : undefined}
      />

      <div className="space-y-10 px-6 py-8 lg:px-10">
        {denied ? <p role="alert" className="rounded border border-caution/30 bg-caution/5 px-4 py-2.5 text-sm text-caution">Your role in this workspace doesn&apos;t allow that action.</p> : null}

        <section aria-labelledby="overview">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="overview" className="text-lg font-semibold">Business overview</h2>
            {overview?.period ? <p className="text-sm text-ink-muted">{overview.period.current}, compared with {overview.period.baseline} · from {selected?.name}</p> : selected ? <p className="text-sm text-ink-muted">From {selected.name}</p> : null}
          </div>
          <div className="mt-4">
            {!selected ? (
              <p className="rounded-lg border border-dashed border-line px-5 py-6 text-ink-soft">
                {datasetCount ? "None of your datasets has both a date column and a revenue or quantity column, which the overview needs." : "Upload a dataset with dates and revenue to see your business overview here."}
              </p>
            ) : overviewError ? (
              <p className="rounded-lg border border-caution/30 bg-caution/5 px-5 py-4 text-sm text-caution">The overview couldn&apos;t be calculated because the data engine isn&apos;t reachable. The rest of the dashboard still works.</p>
            ) : overview ? (
              <div className="space-y-6">
                {overview.kpis.length ? (
                  <KpiCards kpis={overview.kpis.map((k) => ({ label: k.label, value: k.value, format: k.format, changePct: k.change_pct, note: overview!.period ? `vs ${overview!.period.baseline}` : undefined }))} />
                ) : null}
                {overview.notes.map((n) => <p key={n} className="text-sm text-ink-muted">{n}</p>)}
                <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
                  {overview.series.length > 1 && valueKpi ? (
                    <div className="rounded-lg border border-line bg-paper-raised p-4">
                      <TrendChart series={overview.series} label={valueKpi.label} format={valueKpi.format} />
                    </div>
                  ) : null}
                  {overview.movers.length ? (
                    <div className="rounded-lg border border-line bg-paper-raised p-4">
                      <h3 className="font-semibold">Biggest changes in {overview.period?.current}</h3>
                      <p className="text-xs text-ink-muted">Calculated from your data, compared with {overview.period?.baseline}</p>
                      <ul className="mt-3 space-y-3">
                        {overview.movers.flatMap((m) => m.rows.slice(0, 2).map((r) => (
                          <li key={m.dimension + r.value} className="flex items-baseline justify-between gap-3 text-sm">
                            <span><span className="text-ink-muted">{m.dimension}</span> <span className="font-medium">{r.value}</span></span>
                            <span className={`num shrink-0 ${r.change > 0 ? "text-up" : r.change < 0 ? "text-down" : "text-ink-muted"}`}>
                              {r.change > 0 ? "▲" : r.change < 0 ? "▼" : "■"} {formatMetric(Math.abs(r.change), valueKpi?.format ?? "number")}
                              {r.change_pct != null ? ` (${Math.abs(r.change_pct).toFixed(1)}%)` : ""}
                            </span>
                          </li>
                        )))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {pins.length ? (
          <section aria-labelledby="pinned">
            <h2 id="pinned" className="text-lg font-semibold">Pinned charts</h2>
            <div className="mt-4 grid gap-6 xl:grid-cols-2">
              {pins.map((p) => <PinnedChart key={p.id} {...p} canEdit={canEdit} />)}
            </div>
          </section>
        ) : null}

        <div className="grid gap-10 xl:grid-cols-[2fr_1fr]">
          <section aria-labelledby="recent">
            <div className="flex items-baseline justify-between">
              <h2 id="recent" className="text-lg font-semibold">Recent analyses</h2>
              <Link href="/analyst" className="text-sm font-semibold text-signal hover:underline">New analysis</Link>
            </div>
            {recent.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-line px-5 py-6 text-ink-soft">No analyses yet. Ask the AI Analyst a question about your data.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-paper-raised">
                {recent.map((a) => (
                  <li key={a.id}>
                    <Link href={`/analyst/${a.conversationId}`} className="grid gap-4 px-5 py-4 hover:bg-paper sm:grid-cols-[1fr_160px]">
                      <div className="min-w-0">
                        <p className="font-medium">{a.question}</p>
                        <p className="mt-0.5 text-sm text-ink-soft">{a.summary}</p>
                        <p className="mt-1 text-xs text-ink-muted">{a.datasetName} · {formatDate(a.createdAt)}</p>
                      </div>
                      <div aria-hidden className="hidden sm:block"><MiniChart result={a.result} plan={a.plan} /></div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="space-y-10">
            {checklist.some((c) => !c.done) ? (
              <section aria-labelledby="start">
                <h2 id="start" className="text-lg font-semibold">Getting started</h2>
                <ol className="mt-4 divide-y divide-line rounded-lg border border-line bg-paper-raised">
                  {checklist.map((item, i) => (
                    <li key={item.label} className="flex gap-3 px-4 py-3">
                      <span aria-hidden className={`num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${item.done ? "bg-up text-white" : "border border-line text-ink-muted"}`}>{item.done ? "✓" : i + 1}</span>
                      <p className={item.done ? "text-ink-soft line-through decoration-ink-muted/50" : "font-medium"}>
                        {item.done ? item.label : <Link href={item.href} className="text-signal hover:underline">{item.label}</Link>}
                        <span className="sr-only">{item.done ? " (done)" : " (to do)"}</span>
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            <section aria-labelledby="activity">
              <h2 id="activity" className="text-lg font-semibold">Recent activity</h2>
              {activity.length === 0 ? <p className="mt-4 text-sm text-ink-soft">No activity yet.</p> : (
                <ul className="mt-4 space-y-2 text-sm">
                  {activity.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3">
                      <span><span className="font-medium">{a.user?.id === session.user.id ? "You" : a.user?.name ?? "Someone"}</span> {ACTIVITY_LABEL[a.action]}</span>
                      <time className="num shrink-0 text-ink-muted" dateTime={a.createdAt.toISOString()}>{formatDate(a.createdAt)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
