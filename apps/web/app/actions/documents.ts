"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, db, documentChunks, documents, eq, isNull } from "@insight/database";
import { requireWorkspace } from "@/lib/server/workspace";
import { deleteVectors } from "@/lib/server/knowledge";
import { deleteDocumentFiles } from "@/lib/server/engine";
import { audit } from "@/lib/server/audit";
import { errorFields, logger } from "@/lib/server/logger";

export async function deleteDocument(form: FormData) {
  const { session, workspace } = await requireWorkspace("MEMBER");
  const id = z.string().uuid().safeParse(form.get("documentId"));
  if (!id.success) redirect("/knowledge");
  const [doc] = await db.update(documents).set({ deletedAt: new Date() })
    .where(and(eq(documents.id, id.data), eq(documents.workspaceId, workspace.id), isNull(documents.deletedAt)))
    .returning({ id: documents.id, name: documents.name });
  if (!doc) redirect("/knowledge");
  // Hidden from search immediately (search re-checks deleted_at); then remove vectors, text and file.
  const chunks = await db.select({ id: documentChunks.id }).from(documentChunks)
    .where(and(eq(documentChunks.documentId, doc.id), eq(documentChunks.workspaceId, workspace.id)));
  try {
    if (chunks.length) await deleteVectors(workspace.id, chunks.map((c) => c.id));
    await db.delete(documentChunks).where(and(eq(documentChunks.documentId, doc.id), eq(documentChunks.workspaceId, workspace.id)));
    await deleteDocumentFiles(workspace.id, doc.id);
  } catch (err) {
    logger.error("document.cleanup_failed", { documentId: doc.id, ...errorFields(err) });
  }
  await audit({ action: "document.delete", userId: session.user.id, workspaceId: workspace.id, targetType: "document", targetId: doc.id, metadata: { name: doc.name } });
  revalidatePath("/knowledge");
  redirect("/knowledge?deleted=1");
}
