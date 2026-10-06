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

const STOP = new Set("the a an of to and or for in on at by with is are was were be been our we you your what whats how who whom does do did this that these those it its as from can could should would will about which when where why there their they them than then into over under per any all some much many more most less".split(" "));

/** Distinctive words of a question (no stop words, at least 3 characters). */
export function questionTerms(q: string): string[] {
  return [...new Set((q.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter((w) => !STOP.has(w)))].slice(0, 12);
}

export function termMatches(text: string, terms: string[]): number {
  const t = text.toLowerCase();
  return terms.filter((w) => t.includes(w.replace(/s$/, ""))).length;
}

/** The lines of a passage that best match the question (plus its first line for context),
 * in original order, so a planner sees the drill row of a price list, not only its intro. */
export function focusedExcerpt(text: string, question: string, max = 700): string {
  const terms = questionTerms(question);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (text.length <= max || !terms.length) return text.slice(0, max);
  const scored = lines.map((l, i) => ({ l, i, s: termMatches(l, terms) }));
  const keep = new Set<number>([0]);
  let len = lines[0].length;
  for (const x of [...scored].filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i)) {
    if (len + x.l.length + 1 > max) break;
    keep.add(x.i); len += x.l.length + 1;
  }
  return [...keep].sort((a, b) => a - b).map((i, k, arr) => (k > 0 && i !== arr[k - 1] + 1 ? "… " : "") + lines[i]).join("\n");
}

export function pageLabel(start: number | null, end: number | null): string | null {
  if (start == null) return null;
  return end != null && end !== start ? `pp. ${start}–${end}` : `p. ${start}`;
}
