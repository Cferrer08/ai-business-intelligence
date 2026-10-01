import "server-only";
import type { EngineIngestResponse } from "@insight/types";
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
