import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, count, db, documentChunks, documents, eq, isNull } from "@insight/database";
import { getApiWorkspace } from "@/lib/server/workspace";
import { EngineRejected, EngineUnavailable, extractDocument } from "@/lib/server/engine";
import { deleteVectors, EMBEDDING_MODEL, getEmbedder, knowledgeConfigured, upsertVectors, VectorStoreError } from "@/lib/server/knowledge";
import { recordAiUsage } from "@/lib/server/ai";
import { checkDocument, MAX_DOC_BYTES, MAX_DOCUMENTS_PER_WORKSPACE } from "@/lib/knowledge/rules";
import { audit } from "@/lib/server/audit";
import { clientIp } from "@/lib/auth/session";
import { errorFields, logger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status });

export async function POST(req: Request) {
  const auth = await getApiWorkspace("MEMBER");
  if (!auth.ok) return fail(auth.status, auth.message);
  const { session, workspace } = auth.ctx;
  const cfg = knowledgeConfigured();
  if (!cfg.ok) return fail(503, `The knowledge base isn't configured. Add ${cfg.missing.join(", ")} to apps/web/.env.local and restart the app.`);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_DOC_BYTES + 1024 * 1024) return fail(413, "The file is too large.");

  let file: File | null = null;
  try {
    const v = (await req.formData()).get("file");
    file = v instanceof File ? v : null;
  } catch {
    return fail(400, "The upload didn't arrive complete. Try again.");
  }
  if (!file) return fail(400, "Choose a file to upload.");
  const problem = checkDocument(file);
  if (problem) return fail(422, problem);
  const [{ n }] = await db.select({ n: count() }).from(documents).where(and(eq(documents.workspaceId, workspace.id), isNull(documents.deletedAt)));
  if (n >= MAX_DOCUMENTS_PER_WORKSPACE) return fail(409, `This workspace has reached ${MAX_DOCUMENTS_PER_WORKSPACE} documents.`);

  const [row] = await db.insert(documents).values({
    workspaceId: workspace.id, name: file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim().slice(0, 160) || "Untitled document",
    originalFilename: file.name.slice(0, 255), fileFormat: file.name.split(".").pop()!.toLowerCase(), sizeBytes: file.size,
    status: "processing", createdById: session.user.id, embeddingModel: EMBEDDING_MODEL,
  }).returning({ id: documents.id });
  const scope = and(eq(documents.id, row.id), eq(documents.workspaceId, workspace.id));
  let upserted: string[] = [];

  try {
    const extracted = await extractDocument(workspace.id, row.id, file);
    const embedder = getEmbedder();
    // Embed with the document title and section heading as context: a passage in "Pricing
    // policy" under "Discount approvals" should match "what does our pricing policy say".
    const [docRow] = await db.select({ name: documents.name }).from(documents).where(scope);
    const inputs = extracted.chunks.map((c) => [docRow?.name, c.heading, c.text].filter(Boolean).join("\n"));
    const { vectors, usage } = await embedder.embed(inputs);
    await recordAiUsage({ workspaceId: workspace.id, userId: session.user.id, analysisRequestId: null, purpose: "embed_document", model: embedder.model, usage, succeeded: true });
    const chunkRows = extracted.chunks.map((c) => ({
      id: randomUUID(), documentId: row.id, workspaceId: workspace.id, chunkIndex: c.index, text: c.text,
      pageStart: c.page_start, pageEnd: c.page_end, heading: c.heading?.slice(0, 160) ?? null, flagged: c.flagged,
    }));
    await db.transaction(async (tx) => {
      for (let i = 0; i < chunkRows.length; i += 500) await tx.insert(documentChunks).values(chunkRows.slice(i, i + 500));
    });
    await upsertVectors(workspace.id, chunkRows.map((c, i) => ({
      id: c.id, values: vectors[i], metadata: { workspace_id: workspace.id, document_id: row.id, chunk_index: c.chunkIndex },
    })));
    upserted = chunkRows.map((c) => c.id);
    const flagged = chunkRows.filter((c) => c.flagged).length;
    await db.update(documents).set({
      status: "ready", pages: extracted.pages, chunkCount: chunkRows.length, flaggedCount: flagged, warnings: extracted.warnings,
      fileFormat: extracted.file_format,
    }).where(scope);
    await audit({ action: "document.upload", userId: session.user.id, workspaceId: workspace.id, targetType: "document", targetId: row.id,
      ipAddress: await clientIp(), metadata: { format: extracted.file_format, pages: extracted.pages, chunks: chunkRows.length, flagged } });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    let message = "Something went wrong while processing your document. Your other data was not affected.";
    let status = 500;
    if (err instanceof EngineRejected) { message = err.message; status = err.status === 503 ? 503 : 422; }
    else if (err instanceof EngineUnavailable) { message = "The data engine isn't reachable right now. Check that it's running, then try again."; status = 503; }
    else if (err instanceof VectorStoreError) { message = err.message; status = 503; }
    else if ((err as { code?: string }).code === "auth") { message = "The AI service rejected the API key, so the document couldn't be indexed."; status = 503; }
    else logger.error("document.upload_failed", { documentId: row.id, ...errorFields(err) });
    // Clean up anything already indexed so a failed document never shows up in search.
    if (upserted.length) await deleteVectors(workspace.id, upserted).catch(() => {});
    await db.delete(documentChunks).where(and(eq(documentChunks.documentId, row.id), eq(documentChunks.workspaceId, workspace.id))).catch(() => {});
    await db.update(documents).set({ status: "failed", errorMessage: message.slice(0, 500) }).where(scope);
    return fail(status, message, { id: row.id });
  }
}
