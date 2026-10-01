"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, datasets, db, eq, isNull } from "@insight/database";
import { requireWorkspace } from "@/lib/server/workspace";
import { deleteDatasetFiles } from "@/lib/server/engine";
import { audit } from "@/lib/server/audit";
import { errorFields, logger } from "@/lib/server/logger";

export async function deleteDataset(form: FormData) {
  const { session, workspace } = await requireWorkspace("MEMBER");
  const id = z.string().uuid().safeParse(form.get("datasetId"));
  if (!id.success) redirect("/data");

  // Scoped to the active workspace: an id from another workspace matches nothing.
  const [deleted] = await db
    .update(datasets)
    .set({ deletedAt: new Date() })
    .where(and(eq(datasets.id, id.data), eq(datasets.workspaceId, workspace.id), isNull(datasets.deletedAt)))
    .returning({ id: datasets.id, name: datasets.name });
  if (!deleted) redirect("/data");

  try {
    await deleteDatasetFiles(workspace.id, deleted.id);
  } catch (err) {
    // The record is already hidden; leftover files are logged for cleanup, not shown to the user.
    logger.error("dataset.file_delete_failed", { datasetId: deleted.id, ...errorFields(err) });
  }
  await audit({ action: "dataset.delete", userId: session.user.id, workspaceId: workspace.id, targetType: "dataset", targetId: deleted.id, metadata: { name: deleted.name } });
  revalidatePath("/data");
  redirect("/data?deleted=1");
}
