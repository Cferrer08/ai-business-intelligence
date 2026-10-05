import "server-only";
import { analyticsRuns, anomalies, and, datasets, db, desc, eq, forecasts, isNull } from "@insight/database";
import type { EngineResult } from "@insight/ai";

export type RunKind = "forecast" | "anomalies" | "correlation" | "segmentation" | "trend";
export const PAGE_OF: Record<RunKind, "forecasts" | "anomalies" | "analytics"> = {
  forecast: "forecasts", anomalies: "anomalies", correlation: "analytics", segmentation: "analytics", trend: "analytics",
};

function table(kind: RunKind) {
  return kind === "forecast" ? forecasts : kind === "anomalies" ? anomalies : analyticsRuns;
}

export async function saveRun(kind: RunKind, row: { workspaceId: string; datasetId: string; createdById: string; title: string; spec: object; result: EngineResult; durationMs: number }) {
  if (kind === "forecast") return (await db.insert(forecasts).values(row).returning({ id: forecasts.id }))[0].id;
  if (kind === "anomalies") return (await db.insert(anomalies).values(row).returning({ id: anomalies.id }))[0].id;
  return (await db.insert(analyticsRuns).values({ ...row, kind }).returning({ id: analyticsRuns.id }))[0].id;
}

export async function listRuns(workspaceId: string, page: "forecasts" | "anomalies" | "analytics", limit = 15) {
  const t = page === "forecasts" ? forecasts : page === "anomalies" ? anomalies : analyticsRuns;
  const rows = await db
    .select({ id: t.id, title: t.title, createdAt: t.createdAt, datasetName: datasets.name, ...(page === "analytics" ? { kind: analyticsRuns.kind } : {}) })
    .from(t)
    .innerJoin(datasets, eq(datasets.id, t.datasetId))
    .where(and(eq(t.workspaceId, workspaceId), isNull(datasets.deletedAt)))
    .orderBy(desc(t.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, kind: ((r as { kind?: string }).kind ?? (page === "forecasts" ? "forecast" : "anomalies")) as RunKind }));
}

export async function getRun(workspaceId: string, page: "forecasts" | "anomalies" | "analytics", id: string) {
  const t = page === "forecasts" ? forecasts : page === "anomalies" ? anomalies : analyticsRuns;
  const [row] = await db
    .select({ run: t, datasetName: datasets.name })
    .from(t)
    .innerJoin(datasets, eq(datasets.id, t.datasetId))
    .where(and(eq(t.id, id), eq(t.workspaceId, workspaceId), isNull(datasets.deletedAt)))
    .limit(1);
  return row ?? null;
}

export { table as runTable };
