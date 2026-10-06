import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SidebarNav } from "@/components/app/Sidebar";
import { WorkspaceSwitcher } from "@/components/app/WorkspaceSwitcher";
import { requireWorkspace } from "@/lib/server/workspace";
import { logout } from "@/app/actions/auth";
import { and, count, db, eq, getSchemaStatus, isNull, notifications } from "@insight/database";
import { SchemaOutdated } from "@/components/app/SchemaOutdated";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const schema = await getSchemaStatus();
  if (!schema.ok) return <SchemaOutdated applied={schema.applied} expected={schema.expected} />;
  const { session, workspace, workspaces } = await requireWorkspace();
  const [{ unread }] = await db.select({ unread: count() }).from(notifications)
    .where(and(eq(notifications.userId, session.user.id), eq(notifications.workspaceId, workspace.id), isNull(notifications.readAt)));
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <aside className="border-b border-line bg-paper-sunk md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <Wordmark href="/dashboard" />
        </div>
        <div className="hidden px-2 md:block">
          <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
          <Link href="/onboarding?new=1" className="mt-1 block px-3 text-xs text-ink-muted hover:text-signal">New workspace</Link>
          <Link href="/notifications" className="mt-3 flex items-center justify-between rounded-sm px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-raised/70" aria-label={`Notifications, ${unread} unread`}>
            <span>Notifications</span>
            {unread ? <span className="num rounded-full bg-signal px-2 text-xs font-semibold text-white" data-unread-count>{unread}</span> : null}
          </Link>
        </div>
        <div className="overflow-x-auto px-2 pb-3 md:mt-5 md:flex-1 md:overflow-y-auto">
          <SidebarNav />
        </div>
        <div className="hidden border-t border-line px-4 py-3 md:block">
          <p className="truncate text-sm font-medium">{session.user.name}</p>
          <p className="truncate text-xs text-ink-muted">{session.user.email}</p>
          <form action={logout} className="mt-2">
            <button type="submit" className="text-xs font-semibold text-ink-soft hover:text-down">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
