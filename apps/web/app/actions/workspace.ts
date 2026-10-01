"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, count, db, eq, isNull, sessions, workspaceMembers, workspaces } from "@insight/database";
import type { ActionResult } from "@insight/types";
import { requireSession } from "@/lib/auth/session";
import { assertMembership } from "@/lib/server/workspace";
import { fieldErrors, workspaceNameSchema } from "@/lib/validation";
import { workspaceSlug } from "@/lib/slug";
import { audit } from "@/lib/server/audit";
import { logger } from "@/lib/server/logger";
import { z } from "zod";

export type WorkspaceState = ActionResult | null;

const MAX_OWNED_WORKSPACES = 10; // Plan-based limits replace this in Phase 9.

export async function createWorkspace(_prev: WorkspaceState, form: FormData): Promise<WorkspaceState> {
  const session = await requireSession();
  const parsed = workspaceNameSchema.safeParse({ name: form.get("name") });
  const values = { name: String(form.get("name") ?? "").slice(0, 200) };
  if (!parsed.success) return { ok: false, error: "Check the workspace name.", fieldErrors: fieldErrors(parsed.error), values };

  const [{ owned }] = await db
    .select({ owned: count() })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, session.user.id), eq(workspaceMembers.role, "OWNER"), isNull(workspaces.deletedAt)));
  if (owned >= MAX_OWNED_WORKSPACES) return { ok: false, error: `You can own up to ${MAX_OWNED_WORKSPACES} workspaces.`, values };

  let workspaceId: string;
  try {
    workspaceId = await db.transaction(async (tx) => {
      const [ws] = await tx
        .insert(workspaces)
        .values({ name: parsed.data.name, slug: workspaceSlug(parsed.data.name), createdById: session.user.id })
        .returning({ id: workspaces.id });
      await tx.insert(workspaceMembers).values({ workspaceId: ws.id, userId: session.user.id, role: "OWNER" });
      await tx.update(sessions).set({ activeWorkspaceId: ws.id }).where(eq(sessions.id, session.sessionId));
      return ws.id;
    });
  } catch (err) {
    logger.error("workspace.create_failed", { userId: session.user.id, err: String(err) });
    return { ok: false, error: "The workspace could not be created. Try again.", values };
  }

  await audit({ action: "workspace.create", userId: session.user.id, workspaceId, targetType: "workspace", targetId: workspaceId });
  redirect("/dashboard");
}

export async function switchWorkspace(form: FormData) {
  const session = await requireSession();
  const id = z.string().uuid().safeParse(form.get("workspaceId"));
  if (!id.success) return;

  // Membership is checked server-side; a forged id simply does nothing.
  const member = await assertMembership(session.user.id, id.data);
  if (!member) return;

  await db.update(sessions).set({ activeWorkspaceId: id.data }).where(eq(sessions.id, session.sessionId));
  await audit({ action: "workspace.switch", userId: session.user.id, workspaceId: id.data });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function renameWorkspace(_prev: WorkspaceState, form: FormData): Promise<WorkspaceState> {
  const session = await requireSession();
  const id = z.string().uuid().safeParse(form.get("workspaceId"));
  const parsed = workspaceNameSchema.safeParse({ name: form.get("name") });
  if (!id.success) return { ok: false, error: "Workspace not found." };
  if (!parsed.success) return { ok: false, error: "Check the workspace name.", fieldErrors: fieldErrors(parsed.error), values: { name: String(form.get("name") ?? "").slice(0, 200) } };

  const member = await assertMembership(session.user.id, id.data, "ADMIN");
  if (!member) return { ok: false, error: "Only owners and admins can rename this workspace." };

  await db.update(workspaces).set({ name: parsed.data.name }).where(eq(workspaces.id, id.data));
  await audit({ action: "workspace.rename", userId: session.user.id, workspaceId: id.data, metadata: { name: parsed.data.name } });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
