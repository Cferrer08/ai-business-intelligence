"use client";

import Link from "next/link";
import { useState } from "react";

interface Result { chunkId: string; documentId: string; documentName: string; page: string | null; heading: string | null; text: string; score: number; flagged: boolean }

function highlight(text: string, q: string) {
  const words = [...new Set(q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-caution/20 px-0.5 text-ink">{part}</mark> : part));
}

export function KnowledgeSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setPending(true); setError(null);
    try {
      const res = await fetch(`/api/documents/search?q=${encodeURIComponent(q.trim())}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Search failed.");
      setResults(body.results);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <form onSubmit={search} className="flex gap-2" role="search">
        <label htmlFor="kq" className="sr-only">Search your documents</label>
        <input id="kq" value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder="Search by meaning, e.g. how long do customers have to return items?"
          className="min-w-0 flex-1 rounded border border-line bg-paper-raised px-3 py-2.5 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/25" />
        <button type="submit" disabled={pending || q.trim().length < 2} className="rounded bg-signal px-4 py-2.5 text-sm font-semibold text-white hover:bg-signal-hover disabled:opacity-50">
          {pending ? "Searching…" : "Search"}
        </button>
      </form>
      {error ? <p role="alert" className="mt-3 text-sm text-down">{error}</p> : null}
      {results ? (
        results.length === 0 ? <p className="mt-4 text-sm text-ink-soft">No passages matched.</p> : (
          <ol className="mt-4 space-y-3" aria-label="Search results">
            {results.map((r) => (
              <li key={r.chunkId} className="rounded-lg border border-line bg-paper-raised px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <Link href={`/knowledge/${r.documentId}`} className="font-semibold text-ink hover:text-signal hover:underline">
                    {r.documentName}{r.page ? <span className="font-normal text-ink-muted">, {r.page}</span> : null}
                  </Link>
                  <span className="num text-xs text-ink-muted">relevance {(r.score * 100).toFixed(0)}%</span>
                </div>
                {r.heading ? <p className="text-xs text-ink-muted">{r.heading}</p> : null}
                {r.flagged ? <p className="mt-1 text-xs font-medium text-caution">Reads like instructions to an AI; excluded from AI answers.</p> : null}
                <p className="mt-1.5 line-clamp-4 text-sm text-ink-soft">{highlight(r.text, q)}</p>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}
