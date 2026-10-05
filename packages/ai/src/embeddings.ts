/** OpenAI embeddings over plain HTTP (same approach as llm.ts), batched, with retries. */
import { LlmError, type LlmUsage } from "./llm";

export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<{ vectors: number[][]; usage: LlmUsage }>;
}

const BATCH = 96;
const MAX_INPUT_CHARS = 8000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createOpenAiEmbedder(opts: { apiKey: string; model: string; baseUrl?: string; timeoutMs?: number }): Embedder {
  const base = (opts.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  return {
    model: opts.model,
    async embed(texts) {
      const started = Date.now();
      const vectors: number[][] = [];
      let tokens = 0;
      for (let i = 0; i < texts.length; i += BATCH) {
        const input = texts.slice(i, i + BATCH).map((t) => t.slice(0, MAX_INPUT_CHARS));
        let res: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await sleep(600 * attempt);
          try {
            res = await fetch(`${base}/embeddings`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
              body: JSON.stringify({ model: opts.model, input }),
              signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
            });
          } catch {
            res = null;
            continue;
          }
          if (res.status === 429 || res.status >= 500) continue;
          break;
        }
        if (!res) throw new LlmError("unavailable", "Embedding service unavailable.");
        if (res.status === 401 || res.status === 403) throw new LlmError("auth", "Embedding service rejected the key.");
        if (res.status === 429) throw new LlmError("rate_limit", "Embedding service rate limit.");
        if (!res.ok) throw new LlmError("bad_response", `Embedding service returned ${res.status}.`);
        const body = (await res.json()) as { data: { index: number; embedding: number[] }[]; usage?: { prompt_tokens?: number } };
        const sorted = [...body.data].sort((a, b) => a.index - b.index);
        if (sorted.length !== input.length) throw new LlmError("bad_response", "Embedding count mismatch.");
        vectors.push(...sorted.map((d) => d.embedding));
        tokens += body.usage?.prompt_tokens ?? 0;
      }
      return { vectors, usage: { model: opts.model, inputTokens: tokens, outputTokens: 0, durationMs: Date.now() - started } };
    },
  };
}

/** A passage retrieved from the workspace's documents, as given to the model. */
export interface Passage {
  id: string;           // "d1", "d2": how the model cites it
  chunkId: string;
  documentId: string;
  documentName: string;
  page: string | null;  // "p. 2" or "pp. 2–3"
  heading: string | null;
  text: string;
  score: number;
}

export function pageLabel(start: number | null, end: number | null): string | null {
  if (start == null) return null;
  return end != null && end !== start ? `pp. ${start}–${end}` : `p. ${start}`;
}
