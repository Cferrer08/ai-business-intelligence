import type { Metadata } from "next";
import Link from "next/link";
import { and, auditLogs, count, db, desc, eq, inArray, users, workspaceMembers } from "@insight/database";
import { PageHeader } from "@/components/app/PageHeader";
import { requireWorkspace } from "@/lib/server/workspace";
import { countDatasets } from "@/lib/server/datasets";

export const metadata: Metadata = { title: "Dashboard" };

// Metrics the overview will show once a dataset with the matching columns exists (Phase 2–3).
// Until then they render as empty, never as sample numbers.
const OVERVIEW_METRICS = ["Revenue", "Revenue growth", "Orders", "Customers", "Average order value"];

const ACTIVITY_LABEL: Record<string, string> = {
  "workspace.create": "created the workspace",
  "workspace.rename": "renamed the workspace",
  "workspace.switch": "opened the workspace",
  "auth.login": "signed in",
  "dataset.upload": "uploaded a dataset",
  "dataset.delete": "deleted a dataset",
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { workspace, session } = await requireWorkspace();
  const { denied } = await searchParams;

  const [[{ memberCount }], datasetCount, activity] = await Promise.all([
    db.select({ memberCount: count() }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspace.id)),
    countDatasets(workspace.id),
    db
      .select({ id: auditLogs.id, action: auditLogs.action, createdAt: auditLogs.createdAt, user: { id: users.id, name: users.name } })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(and(eq(auditLogs.workspaceId, workspace.id), inArray(auditLogs.action, Object.keys(ACTIVITY_LABEL))))
      .orderBy(desc(auditLogs.createdAt))
      .limit(6),
  ]);

  const checklist: { label: string; done: boolean; note?: string; href?: string }[] = [
    { label: "Create your account", done: true },
    { label: "Set up a workspace", done: true },
    { label: "Upload your first dataset", done: datasetCount > 0, href: "/data" },
    { label: "Ask the analyst a question", done: false, note: "The AI analyst arrives in phase 3." },
  ];

  return (
    <>
      <PageHeader title={workspace.name} description={`${memberCount} ${memberCount === 1 ? "member" : "members"}, ${datasetCount} ${datasetCount === 1 ? "dataset" : "datasets"}. You're signed in as ${workspace.role.toLowerCase()}.`} />

      <div className="space-y-10 px-6 py-8 lg:px-10">
        {denied ? (
          <p role="alert" className="rounded border border-caution/30 bg-caution/5 px-4 py-2.5 text-sm text-caution">
            Your role in this workspace doesn&apos;t allow that action.
          </p>
        ) : null}

        <section aria-labelledby="overview">
          <h2 id="overview" className="text-lg font-semibold">Business overview</h2>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-paper-raised">
            <dl className="grid min-w-[640px] grid-cols-5 divide-x divide-line">
              {OVERVIEW_METRICS.map((m) => (
                <div key={m} className="px-5 py-4">
                  <dt className="text-sm text-ink-muted">{m}</dt>
                  <dd className="num mt-1 text-2xl font-semibold text-ink-muted/60" aria-label="No data yet">—</dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-line px-5 py-3 text-sm text-ink-soft">
              {datasetCount > 0
                ? "The AI analyst (phase 3) calculates these from your datasets with date and revenue columns."
                : "These are calculated from your own data once you upload a dataset with dates and revenue."}
            </p>
          </div>
        </section>

        <div className="grid gap-10 lg:grid-cols-2">
          <section aria-labelledby="start">
            <h2 id="start" className="text-lg font-semibold">Getting started</h2>
            <ol className="mt-4 divide-y divide-line rounded-lg border border-line bg-paper-raised">
              {checklist.map((item, i) => (
                <li key={item.label} className="flex gap-4 px-5 py-3.5">
                  <span
                    aria-hidden
                    className={`num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${item.done ? "bg-up text-white" : "border border-line text-ink-muted"}`}
                  >
                    {item.done ? "✓" : i + 1}
                  </span>
                  <div>
                    <p className={item.done ? "text-ink-soft line-through decoration-ink-muted/50" : "font-medium"}>
                      {item.href && !item.done ? <Link href={item.href} className="text-signal hover:underline">{item.label}</Link> : item.label}
                      <span className="sr-only">{item.done ? " (done)" : " (to do)"}</span>
                    </p>
                    {item.note ? <p className="text-sm text-ink-muted">{item.note}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="activity">
            <div className="flex items-baseline justify-between">
              <h2 id="activity" className="text-lg font-semibold">Recent activity</h2>
              <Link href="/settings" className="text-sm font-semibold text-signal hover:underline">Workspace settings</Link>
            </div>
            {activity.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-line px-5 py-6 text-ink-soft">No activity yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-paper-raised">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-4 px-5 py-3 text-sm">
                    <span>
                      <span className="font-medium">{a.user?.id === session.user.id ? "You" : a.user?.name ?? "Someone"}</span>{" "}
                      {ACTIVITY_LABEL[a.action]}
                    </span>
                    <time dateTime={a.createdAt.toISOString()} className="num shrink-0 text-ink-muted">
                      {a.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
