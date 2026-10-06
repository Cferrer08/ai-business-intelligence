import "server-only";
import { and, db, documentChunks, documents, eq, inArray, isNull, sql } from "@insight/database";
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
  matchedTerms: number;            // distinct question words found in the passage
  source: "vector" | "keyword" | "both";
}

const STOP = new Set("the a an of to and or for in on at by with is are was were be been our we you your what whats how who whom does do did this that these those it its as from can could should would will about which when where why there their they them than then into over under per any all some much many more most less".split(" "));

/** Distinctive words of a question, lower-cased (no stop words, at least 3 letters). */
export function queryTerms(q: string): string[] {
  return [...new Set((q.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter((w) => !STOP.has(w)))].slice(0, 12);
}

function countMatches(text: string, terms: string[]): number {
  const t = text.toLowerCase();
  return terms.filter((w) => t.includes(w.replace(/s$/, ""))).length;
}

/** Full-text search in PostgreSQL over this workspace's ready documents. */
async function keywordHits(workspaceId: string, terms: string[], limit: number): Promise<{ chunkId: string; rank: number }[]> {
  const safe = terms.map((w) => w.replace(/[^a-z0-9]/g, "")).filter((w) => w.length >= 3);
  if (!safe.length) return [];
  const tsquery = safe.join(" | ");
  const rows = await db.execute(sql`
    select c.id as chunk_id, ts_rank_cd(to_tsvector('english', c.text), to_tsquery('english', ${tsquery})) as rank
    from document_chunks c join documents d on d.id = c.document_id
    where c.workspace_id = ${workspaceId} and d.workspace_id = ${workspaceId} and d.status = 'ready' and d.deleted_at is null
      and to_tsvector('english', c.text) @@ to_tsquery('english', ${tsquery})
    order by rank desc limit ${limit}`);
  return (rows.rows as { chunk_id: string; rank: number }[]).map((r) => ({ chunkId: r.chunk_id, rank: Number(r.rank) }));
}

/**
 * Hybrid search over this workspace's ready documents: Pinecone vectors (meaning) plus
 * PostgreSQL full-text (exact words such as product names and SKUs), merged by reciprocal
 * rank fusion. Every id is re-checked against PostgreSQL and the workspace before use.
 */
export async function searchKnowledge(workspaceId: string, userId: string, query: string, opts: { includeFlagged: boolean; topK?: number }): Promise<SearchResult[]> {
  const topK = opts.topK ?? TOP_K;
  const terms = queryTerms(query);
  const embedder = getEmbedder();
  const vectorPart = (async () => {
    try {
      const { vectors, usage } = await embedder.embed([query]);
      await recordAiUsage({ workspaceId, userId, analysisRequestId: null, purpose: "embed_query", model: embedder.model, usage, succeeded: true });
      return await queryVectors(workspaceId, vectors[0], topK);
    } catch (err) {
      await recordAiUsage({ workspaceId, userId, analysisRequestId: null, purpose: "embed_query", model: embedder.model, usage: undefined, succeeded: false, errorCode: (err as { code?: string }).code });
      throw err;
    }
  })();
  const [vec, kw] = await Promise.allSettled([vectorPart, keywordHits(workspaceId, terms, topK)]);
  if (vec.status === "rejected" && kw.status === "rejected") throw vec.reason;
  const vHits = vec.status === "fulfilled" ? vec.value : [];
  const kHits = kw.status === "fulfilled" ? kw.value : [];
  if (vec.status === "rejected") logger.warn("knowledge.vector_search_failed", { err: String(vec.reason) });

  const fused = new Map<string, { rrf: number; score: number; inVec: boolean; inKw: boolean }>();
  vHits.forEach((h, i) => fused.set(h.chunkId, { rrf: 1 / (60 + i), score: h.score, inVec: true, inKw: false }));
  kHits.forEach((h, i) => {
    const cur = fused.get(h.chunkId) ?? { rrf: 0, score: 0, inVec: false, inKw: false };
    fused.set(h.chunkId, { ...cur, rrf: cur.rrf + 1 / (60 + i), inKw: true });
  });
  if (!fused.size) return [];

  const rows = await db
    .select({ chunk: documentChunks, documentName: documents.name })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(and(
      inArray(documentChunks.id, [...fused.keys()]),
      eq(documentChunks.workspaceId, workspaceId),
      eq(documents.workspaceId, workspaceId),
      eq(documents.status, "ready"),
      isNull(documents.deletedAt),
    ));
  return rows
    .filter((r) => opts.includeFlagged || !r.chunk.flagged)
    .map((r) => {
      const f = fused.get(r.chunk.id)!;
      return {
        chunkId: r.chunk.id, documentId: r.chunk.documentId, documentName: r.documentName,
        page: pageLabel(r.chunk.pageStart, r.chunk.pageEnd), heading: r.chunk.heading, text: r.chunk.text, flagged: r.chunk.flagged,
        score: f.score, rrf: f.rrf, matchedTerms: countMatches(`${r.documentName} ${r.chunk.heading ?? ""} ${r.chunk.text}`, terms),
        source: (f.inVec && f.inKw ? "both" : f.inVec ? "vector" : "keyword") as SearchResult["source"],
      };
    })
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, topK)
    .map(({ rrf: _rrf, ...r }) => r);
}

/**
 * Passages for the AI analyst, labelled d1..d5, never flagged. Relevant means a good
 * embedding match OR at least two of the question's distinctive words in the passage, so a
 * price-list row is found for "contractor price of the cordless drill" even when the
 * embedding of a long table scores low.
 */
export async function retrievePassages(workspaceId: string, userId: string, question: string): Promise<Passage[]> {
  const terms = queryTerms(question);
  const need = Math.min(2, terms.length);
  const results = await searchKnowledge(workspaceId, userId, question, { includeFlagged: false });
  return results
    .filter((r) => r.score >= MIN_SCORE || (need > 0 && r.matchedTerms >= need && r.source !== "vector"))
    .slice(0, MAX_PASSAGES)
    .map((r, i) => ({ id: `d${i + 1}`, chunkId: r.chunkId, documentId: r.documentId, documentName: r.documentName, page: r.page, heading: r.heading, text: r.text, score: r.score }));
}

export async function workspaceHasDocuments(workspaceId: string): Promise<boolean> {
  const [row] = await db.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.status, "ready"), isNull(documents.deletedAt))).limit(1);
  return Boolean(row);
}
