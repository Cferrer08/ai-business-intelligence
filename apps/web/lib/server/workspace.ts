import "server-only";
import { redirect } from "next/navigation";
import { and, asc, db, eq, isNull, workspaceMembers, workspaces as workspacesTable } from "@insight/database";
import type { WorkspaceRole, WorkspaceSummary } from "@insight/types";
import { requireSession, type CurrentSession } from "@/lib/auth/session";

import { roleAtLeast } from "@/lib/roles";

export { roleAtLeast };

export async function listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  return db
    .select({ id: workspacesTable.id, name: workspacesTable.name, slug: workspacesTable.slug, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspacesTable, eq(workspacesTable.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspacesTable.deletedAt)))
    .orderBy(asc(workspaceMembers.createdAt));
}

export interface WorkspaceContext {
  session: CurrentSession;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
}

/**
 * The single entry point for tenant-scoped pages and actions.
 * Every later query (datasets, analyses, vectors, reports) takes workspace.id from here,
 * never from user input, which is how cross-tenant access is prevented.
 */
export async function requireWorkspace(minimumRole: WorkspaceRole = "VIEWER"): Promise<WorkspaceContext> {
  const session = await requireSession();
  const workspaces = await listWorkspaces(session.user.id);
  if (workspaces.length === 0) redirect("/onboarding");

  const workspace = workspaces.find((w) => w.id === session.activeWorkspaceId) ?? workspaces[0];
  if (!roleAtLeast(workspace.role, minimumRole)) redirect("/dashboard?denied=1");

  return { session, workspace, workspaces };
}

/** For actions that receive a workspace id: verifies membership before anything else happens. */
export async function assertMembership(userId: string, workspaceId: string, minimumRole: WorkspaceRole = "VIEWER") {
  const [member] = await db
    .select({ id: workspaceMembers.id, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspacesTable, eq(workspacesTable.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId), isNull(workspacesTable.deletedAt)))
    .limit(1);
  if (!member || !roleAtLeast(member.role, minimumRole)) return null;
  return member;
}
