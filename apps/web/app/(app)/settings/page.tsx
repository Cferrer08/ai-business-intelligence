import type { Metadata } from "next";
import { asc, db, eq, users, workspaceMembers } from "@insight/database";
import { PageHeader } from "@/components/app/PageHeader";
import { RenameWorkspaceForm } from "@/components/app/RenameWorkspaceForm";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";

export const metadata: Metadata = { title: "Settings" };

const ROLE_LABEL = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member", VIEWER: "Viewer" } as const;

export default async function SettingsPage() {
  const { workspace, session } = await requireWorkspace();
  const members = await db
    .select({ id: workspaceMembers.id, role: workspaceMembers.role, user: { id: users.id, name: users.name, email: users.email } })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspace.id))
    .orderBy(asc(workspaceMembers.createdAt));

  return (
    <>
      <PageHeader title="Settings" description="Manage this workspace and who can access it." />
      <div className="max-w-3xl space-y-12 px-6 py-8 lg:px-10">
        <section aria-labelledby="general">
          <h2 id="general" className="text-lg font-semibold">General</h2>
          <div className="mt-4">
            <RenameWorkspaceForm workspaceId={workspace.id} name={workspace.name} canEdit={roleAtLeast(workspace.role, "ADMIN")} />
          </div>
        </section>

        <section aria-labelledby="members">
          <h2 id="members" className="text-lg font-semibold">Members</h2>
          <p className="mt-1 text-sm text-ink-soft">Inviting teammates becomes available with team workspaces on the Business plan.</p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-paper-raised">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b border-line text-ink-muted">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Name</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Email</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3 font-medium">{m.user.name}{m.user.id === session.user.id ? <span className="text-ink-muted"> (you)</span> : null}</td>
                    <td className="px-5 py-3 text-ink-soft">{m.user.email}</td>
                    <td className="px-5 py-3">{ROLE_LABEL[m.role]}</td>
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
