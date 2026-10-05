import "server-only";
import type { EngineIngestResponse } from "@insight/types";
import { AnalysisExecutionError, type EngineResult } from "@insight/ai";
import { logger } from "./logger";

const BASE_URL = (process.env.FASTAPI_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const INGEST_TIMEOUT_MS = 180_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export class EngineUnavailable extends Error {}

/** A failure the engine explained in user-safe words (bad file, limits, busy). */
export class EngineRejected extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

function key(): string {
  const k = process.env.ENGINE_API_KEY;
  if (!k) throw new EngineUnavailable("ENGINE_API_KEY is not set");
  return k;
}

async function call(path: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), "X-Engine-Key": key() },
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: "no-store",
    });
    logger.info("engine.call", { path: path.replace(/[0-9a-f-]{36}/g, ":id"), status: res.status, ms: Date.now() - started });
    return res;
  } catch (err) {
    logger.error("engine.unreachable", { path: path.replace(/[0-9a-f-]{36}/g, ":id"), ms: Date.now() - started, err: String(err) });
    throw new EngineUnavailable(String(err));
  }
}

async function rejection(res: Response): Promise<EngineRejected> {
  let code = "engine_error";
  let message = "The file couldn't be processed.";
  try {
    const body = (await res.json()) as { detail?: { code?: string; message?: string } };
    // Only messages from our own error handler are shown; 5xx details stay in the logs.
    if (res.status < 500 || res.status === 503) {
      code = body.detail?.code ?? code;
      message = body.detail?.message ?? message;
    }
  } catch {
    /* non-JSON response */
  }
  if (res.status === 401) logger.error("engine.auth_failed", { hint: "ENGINE_API_KEY differs between web app and engine" });
  return new EngineRejected(code, message, res.status);
}

export async function ingestDataset(workspaceId: string, datasetId: string, file: File): Promise<EngineIngestResponse> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("filename", file.name);
  const res = await call(`/v1/workspaces/${workspaceId}/datasets/${datasetId}/ingest`, {
    method: "POST",
    body: form,
    timeoutMs: INGEST_TIMEOUT_MS,
  });
  if (!res.ok) throw await rejection(res);
  return (await res.json()) as EngineIngestResponse;
}

export async function deleteDatasetFiles(workspaceId: string, datasetId: string): Promise<void> {
  const res = await call(`/v1/workspaces/${workspaceId}/datasets/${datasetId}`, { method: "DELETE" });
  if (!res.ok) throw await rejection(res);
}

export interface ColumnRoleInput {
  name: string;
  logical_type: string;
  role: string;
  concept: string | null;
}

/** Runs a validated analysis spec. Engine-explained problems become AnalysisExecutionError
 * (so the analyst can repair the plan); anything else is EngineUnavailable/EngineRejected. */
export async function analyzeDataset(workspaceId: string, datasetId: string, spec: Record<string, unknown>, columns: ColumnRoleInput[]): Promise<EngineResult> {
  const res = await call(`/v1/workspaces/${workspaceId}/datasets/${datasetId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spec, columns }),
    timeoutMs: 60_000,
  });
  if (res.ok) return (await res.json()) as EngineResult;
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
    const d = body.detail as { code?: string; message?: string } | unknown[] | undefined;
    if (d && !Array.isArray(d) && d.code && d.message) throw new AnalysisExecutionError(d.code, d.message);
    // Pydantic rejected the spec shape: our validation should have caught it, so log it.
    logger.error("engine.spec_rejected", { detail: JSON.stringify(d).slice(0, 500) });
    throw new AnalysisExecutionError("invalid_spec", "The analysis plan wasn't accepted by the data engine. Try rephrasing the question.");
  }
  throw await rejection(res);
}

export interface DashboardData {
  columns: { time: string | null; value: string | null; orders: string | null; customers: string | null };
  period: { current: string; baseline: string } | null;
  kpis: { key: string; label: string; value: number | null; format: "money" | "number"; change_pct: number | null }[];
  series: { month: string; value: number; orders: number; partial: boolean }[];
  movers: { dimension: string; rows: { value: string; current: number; baseline: number; change: number; change_pct: number | null }[] }[];
  notes: string[];
}

export async function dashboardData(workspaceId: string, datasetId: string, columns: ColumnRoleInput[]): Promise<DashboardData> {
  const res = await call(`/v1/workspaces/${workspaceId}/datasets/${datasetId}/dashboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ columns }),
    timeoutMs: 20_000,
  });
  if (!res.ok) throw await rejection(res);
  return (await res.json()) as DashboardData;
}

export interface ExtractedDocument {
  file_format: string;
  size_bytes: number;
  pages: number | null;
  characters: number;
  warnings: string[];
  chunks: { index: number; text: string; page_start: number | null; page_end: number | null; heading: string | null; flagged: boolean }[];
}

export async function extractDocument(workspaceId: string, documentId: string, file: File): Promise<ExtractedDocument> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("filename", file.name);
  const res = await call(`/v1/workspaces/${workspaceId}/documents/${documentId}/extract`, { method: "POST", body: form, timeoutMs: 120_000 });
  if (!res.ok) throw await rejection(res);
  return (await res.json()) as ExtractedDocument;
}

export async function deleteDocumentFiles(workspaceId: string, documentId: string): Promise<void> {
  const res = await call(`/v1/workspaces/${workspaceId}/documents/${documentId}`, { method: "DELETE" });
  if (!res.ok) throw await rejection(res);
}
