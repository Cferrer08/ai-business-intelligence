import "server-only";
import { and, db, documentChunks, documents, eq, inArray, isNull } from "@insight/database";
import { createOpenAiEmbedder, pageLabel, type Embedder, type Passage } from "@insight/ai";
import { recordAiUsage } from "./ai";
import { logger } from "./logger";

/**
 * Knowledge base plumbing: embeddings (OpenAI) and vector search (Pinecone REST API).
 * Isolation is layered: one Pinecone namespace per workspace, a workspace_id filter on
 * every query, and every returned id re-checked against PostgreSQL with the workspace
 * before any text is used. Passages flagged as instruction-like never reach a model.
 */

export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const API_VERSION = process.env.PINECONE_API_VERSION || "2025-01";
const MIN_SCORE = Number(process.env.RAG_MIN_SCORE ?? 0.3);
const TOP_K = 8;
const MAX_PASSAGES = 5;

export function knowledgeConfigured(): { ok: boolean; missing: string[] } {
  const missing = ["OPENAI_API_KEY", "PINECONE_API_KEY"].filter((k) => !process.env[k]);
  if (!process.env.PINECONE_INDEX && !process.env.PINECONE_HOST) missing.push("PINECONE_INDEX");
  return { ok: missing.length === 0, missing };
}

export function getEmbedder(): Embedder {
  return createOpenAiEmbedder({ apiKey: process.env.OPENAI_API_KEY!, model: EMBEDDING_MODEL, baseUrl: process.env.OPENAI_BASE_URL || undefined });
}

export class VectorStoreError extends Error {}

let cachedHost: string | null = null;

async function pineconeHost(): Promise<string> {
  if (process.env.PINECONE_HOST) return process.env.PINECONE_HOST.startsWith("http") ? process.env.PINECONE_HOST : `https://${process.env.PINECONE_HOST}`;
  if (cachedHost) return cachedHost;
  const control = (process.env.PINECONE_CONTROL_URL || "https://api.pinecone.io").replace(/\/$/, "");
  const res = await fetch(`${control}/indexes/${encodeURIComponent(process.env.PINECONE_INDEX!)}`, {
    headers: { "Api-Key": process.env.PINECONE_API_KEY!, "X-Pinecone-API-Version": API_VERSION },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new VectorStoreError(`Couldn't find the Pinecone index "${process.env.PINECONE_INDEX}" (${res.status}). Check PINECONE_INDEX.`);
  const body = (await res.json()) as { host?: string; dimension?: number };
  if (!body.host) throw new VectorStoreError("Pinecone didn't return a host for the index.");
  cachedHost = body.host.startsWith("http") ? body.host : `https://${body.host}`;
  return cachedHost;
}

async function pinecone(path: string, body: unknown, timeoutMs = 20_000): Promise<any> {
  const host = await pineconeHost();
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 500 * attempt));
    let res: Response;
    try {
      res = await fetch(`${host}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Api-Key": process.env.PINECONE_API_KEY!, "X-Pinecone-API-Version": API_VERSION },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      lastStatus = -1;
      logger.warn("pinecone.unreachable", { path, err: String(err) });
      continue;
    }
    if (res.ok) return res.json().catch(() => ({}));
    lastStatus = res.status;
    if (res.status !== 429 && res.status < 500) break;
  }
  throw new VectorStoreError(lastStatus === 401 || lastStatus === 403 ? "Pinecone rejected the API key." : `The vector database isn't reachable right now (${lastStatus}).`);
}

export async function upsertVectors(workspaceId: string, vectors: { id: string; values: number[]; metadata: Record<string, string | number> }[]) {
  for (let i = 0; i < vectors.length; i += 100) {
    await pinecone("/vectors/upsert", { namespace: workspaceId, vectors: vectors.slice(i, i + 100) });
  }
}

export async function deleteVectors(workspaceId: string, ids: string[]) {
  for (let i = 0; i < ids.length; i += 500) {
    await pinecone("/vectors/delete", { namespace: workspaceId, ids: ids.slice(i, i + 500) });
  }
}

interface Hit { chunkId: string; score: number }

async function queryVectors(workspaceId: string, vector: number[], topK: number): Promise<Hit[]> {
  const out = await pinecone("/query", {
    namespace: workspaceId, vector, topK, includeMetadata: true,
    filter: { workspace_id: { $eq: workspaceId } },
  });
  return ((out.matches ?? []) as { id: string; score: number; metadata?: { workspace_id?: string } }[])
    .filter((m) => m.metadata?.workspace_id === workspaceId)
    .map((m) => ({ chunkId: m.id, score: m.score }));
}

export interface SearchResult {
  chunkId: string; documentId: string; documentName: string; page: string | null; heading: string | null;
  text: string; score: number; flagged: boolean;
}

/** Semantic search over this workspace's ready documents. */
export async function searchKnowledge(workspaceId: string, userId: string, query: string, opts: { includeFlagged: boolean; topK?: number }): Promise<SearchResult[]> {
  const embedder = getEmbedder();
  let vec: number[];
  try {
    const { vectors, usage } = await embedder.embed([query]);
    vec = vectors[0];
    await recordAiUsage({ workspaceId, userId, analysisRequestId: null, purpose: "embed_query", model: embedder.model, usage, succeeded: true });
  } catch (err) {
    await recordAiUsage({ workspaceId, userId, analysisRequestId: null, purpose: "embed_query", model: embedder.model, usage: undefined, succeeded: false, errorCode: (err as { code?: string }).code });
    throw err;
  }
  const hits = await queryVectors(workspaceId, vec, opts.topK ?? TOP_K);
  if (!hits.length) return [];
  // Re-check every id against PostgreSQL and the workspace; only ready, undeleted documents.
  const rows = await db
    .select({ chunk: documentChunks, documentName: documents.name })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(and(
      inArray(documentChunks.id, hits.map((h) => h.chunkId)),
      eq(documentChunks.workspaceId, workspaceId),
      eq(documents.workspaceId, workspaceId),
      eq(documents.status, "ready"),
      isNull(documents.deletedAt),
    ));
  const byId = new Map(rows.map((r) => [r.chunk.id, r]));
  return hits
    .map((h) => ({ h, r: byId.get(h.chunkId) }))
    .filter((x): x is { h: Hit; r: NonNullable<typeof x.r> } => Boolean(x.r) && (opts.includeFlagged || !x.r!.chunk.flagged))
    .map(({ h, r }) => ({
      chunkId: r.chunk.id, documentId: r.chunk.documentId, documentName: r.documentName,
      page: pageLabel(r.chunk.pageStart, r.chunk.pageEnd), heading: r.chunk.heading, text: r.chunk.text, score: h.score, flagged: r.chunk.flagged,
    }));
}

/** Passages for the AI analyst: relevant, never flagged, labelled d1..d5. */
export async function retrievePassages(workspaceId: string, userId: string, question: string): Promise<Passage[]> {
  const results = await searchKnowledge(workspaceId, userId, question, { includeFlagged: false });
  return results
    .filter((r) => r.score >= MIN_SCORE)
    .slice(0, MAX_PASSAGES)
    .map((r, i) => ({ id: `d${i + 1}`, chunkId: r.chunkId, documentId: r.documentId, documentName: r.documentName, page: r.page, heading: r.heading, text: r.text, score: r.score }));
}

export async function workspaceHasDocuments(workspaceId: string): Promise<boolean> {
  const [row] = await db.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.status, "ready"), isNull(documents.deletedAt))).limit(1);
  return Boolean(row);
}
