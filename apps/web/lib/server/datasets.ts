import "server-only";
import { and, asc, count, datasetColumns, datasetProfiles, datasets, db, desc, eq, isNull } from "@insight/database";
import type { DatasetProfile } from "@insight/types";

// Every function takes the workspace id from requireWorkspace()/getApiWorkspace(), never
// from the request, and filters on it. A dataset id from another workspace simply isn't found.

export async function listDatasets(workspaceId: string) {
  return db
    .select()
    .from(datasets)
    .where(and(eq(datasets.workspaceId, workspaceId), isNull(datasets.deletedAt)))
    .orderBy(desc(datasets.createdAt));
}

export async function countDatasets(workspaceId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(datasets)
    .where(and(eq(datasets.workspaceId, workspaceId), isNull(datasets.deletedAt)));
  return n;
}

export async function getDataset(workspaceId: string, datasetId: string) {
  const [row] = await db
    .select()
    .from(datasets)
    .where(and(eq(datasets.id, datasetId), eq(datasets.workspaceId, workspaceId), isNull(datasets.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getDatasetProfile(workspaceId: string, datasetId: string) {
  const [row] = await db
    .select({ profile: datasetProfiles.profile, readNotes: datasetProfiles.readNotes, engineVersion: datasetProfiles.engineVersion })
    .from(datasetProfiles)
    .where(and(eq(datasetProfiles.datasetId, datasetId), eq(datasetProfiles.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  return { profile: row.profile as DatasetProfile, readNotes: row.readNotes as string[], engineVersion: row.engineVersion };
}

export async function getDatasetColumns(workspaceId: string, datasetId: string) {
  return db
    .select()
    .from(datasetColumns)
    .where(and(eq(datasetColumns.datasetId, datasetId), eq(datasetColumns.workspaceId, workspaceId)))
    .orderBy(asc(datasetColumns.position));
}
