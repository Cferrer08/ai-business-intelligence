import type { Metadata } from "next";
import Link from "next/link";
import { and, db, desc, eq, notifications } from "@insight/database";
import { PageHeader } from "@/components/app/PageHeader";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { markAllRead } from "@/app/actions/workflows";
import { requireWorkspace } from "@/lib/server/workspace";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { session, workspace } = await requireWorkspace();
  const rows = await db.select().from(notifications).where(and(eq(notifications.userId, session.user.id), eq(notifications.workspaceId, workspace.id)))
    .orderBy(desc(notifications.createdAt)).limit(100);
  return (
    <>
      <PageHeader title="Notifications" description="Briefings, alerts and reports from your workflows."
        actions={rows.some((r) => !r.readAt) ? <form action={markAllRead}><SubmitButton pendingLabel="…" className="!bg-paper-raised !text-ink border border-line">Mark all as read</SubmitButton></form> : undefined} />
      <div className="max-w-3xl px-6 py-8 lg:px-10">
        {rows.length === 0 ? <p className="text-ink-soft">No notifications yet.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-paper-raised">
            {rows.map((n) => (
              <li key={n.id} className={`px-5 py-3 ${n.readAt ? "" : "bg-signal-tint/30"}`} data-unread={!n.readAt || undefined}>
                <div className="flex items-baseline justify-between gap-3">
                  {n.link ? <Link href={n.link} className="font-medium hover:text-signal hover:underline">{n.title}</Link> : <span className="font-medium">{n.title}</span>}
                  <time className="num shrink-0 text-xs text-ink-muted">{formatDate(n.createdAt, true)}</time>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
