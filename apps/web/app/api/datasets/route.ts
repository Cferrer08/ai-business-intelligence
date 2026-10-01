import { NextResponse } from "next/server";
import { and, datasetColumns, datasetProfiles, datasets, db, eq } from "@insight/database";
import { getApiWorkspace } from "@/lib/server/workspace";
import { countDatasets } from "@/lib/server/datasets";
import { EngineRejected, EngineUnavailable, ingestDataset } from "@/lib/server/engine";
import { checkUpload, datasetNameFromFilename, extensionOf, MAX_DATASETS_PER_WORKSPACE, MAX_UPLOAD_BYTES } from "@/lib/datasets/rules";
import { audit } from "@/lib/server/audit";
import { clientIp } from "@/lib/auth/session";
import { errorFields, logger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function fail(status: number, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export async function POST(req: Request) {
  const auth = await getApiWorkspace("MEMBER");
  if (!auth.ok) return fail(auth.status, auth.message);
  const { session, workspace } = auth.ctx;

  // Reject oversized bodies before reading them into memory.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 1024 * 1024) return fail(413, `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);

  let file: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return fail(400, "The upload didn't arrive complete. Try again.");
  }
  if (!file) return fail(400, "Choose a file to upload.");
  const problem = checkUpload(file);
  if (problem) return fail(422, problem);

  if ((await countDatasets(workspace.id)) >= MAX_DATASETS_PER_WORKSPACE) {
    return fail(409, `This workspace has reached ${MAX_DATASETS_PER_WORKSPACE} datasets. Delete one to upload another.`);
  }

  const ext = extensionOf(file.name);
  const [row] = await db
    .insert(datasets)
    .values({
      workspaceId: workspace.id,
      name: datasetNameFromFilename(file.name),
      originalFilename: file.name.slice(0, 255),
      fileFormat: (ext === "jsonl" ? "json" : ext) as "csv" | "xlsx" | "json" | "parquet",
      sizeBytes: file.size,
      status: "processing",
      createdById: session.user.id,
    })
    .returning({ id: datasets.id });
  const scope = and(eq(datasets.id, row.id), eq(datasets.workspaceId, workspace.id));
  const ip = await clientIp();

  try {
    const result = await ingestDataset(workspace.id, row.id, file);
    const p = result.profile;
    await db.transaction(async (tx) => {
      await tx
        .update(datasets)
        .set({ status: "ready", rowCount: p.row_count, columnCount: p.column_count, qualityScore: p.quality.score, fileFormat: result.file_format })
        .where(scope);
      if (p.columns.length) {
        await tx.insert(datasetColumns).values(
          p.columns.map((c) => ({
            datasetId: row.id,
            workspaceId: workspace.id,
            position: c.position,
            name: c.name.slice(0, 120),
            logicalType: c.logical_type,
            semanticRole: c.role.role,
            concept: c.role.concept,
            roleConfidence: c.role.confidence,
            missingCount: c.missing_count,
            uniqueCount: c.unique_count,
            invalidCount: c.invalid_count,
            isInteger: c.is_integer,
            convertedFrom: c.converted_from?.slice(0, 120) ?? null,
            stats: c.stats,
          })),
        );
      }
      await tx.insert(datasetProfiles).values({
        datasetId: row.id,
        workspaceId: workspace.id,
        profile: p,
        readNotes: result.read_notes,
        engineVersion: result.engine_version,
        durationMs: p.profiling_ms,
      });
    });
    await audit({
      action: "dataset.upload",
      userId: session.user.id,
      workspaceId: workspace.id,
      targetType: "dataset",
      targetId: row.id,
      ipAddress: ip,
      metadata: { format: result.file_format, rows: p.row_count, columns: p.column_count, sizeBytes: result.size_bytes },
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    let message = "Something went wrong while processing your file. Your other data was not affected.";
    let status = 500;
    if (err instanceof EngineRejected) {
      message = err.message;
      status = err.status === 503 ? 503 : err.status >= 500 ? 502 : 422;
    } else if (err instanceof EngineUnavailable) {
      message = "The data engine isn't reachable right now. Check that it's running, then try again.";
      status = 503;
    } else {
      logger.error("dataset.upload_failed", { datasetId: row.id, ...errorFields(err) });
    }
    await db.update(datasets).set({ status: "failed", errorMessage: message.slice(0, 500) }).where(scope);
    await audit({
      action: "dataset.upload_failed",
      userId: session.user.id,
      workspaceId: workspace.id,
      targetType: "dataset",
      targetId: row.id,
      ipAddress: ip,
      metadata: { code: err instanceof EngineRejected ? err.code : "unavailable_or_internal" },
    });
    return fail(status, message, { id: row.id });
  }
}
