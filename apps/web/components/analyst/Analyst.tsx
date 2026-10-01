"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StreamEvent, TurnView } from "@/lib/analyst/types";
import { Question, TurnCard } from "./TurnCard";

const STEPS = [
  { key: "planning", label: "Understanding the question" },
  { key: "computing", label: "Calculating from your data" },
  { key: "explaining", label: "Writing the explanation" },
] as const;

interface DatasetOption { id: string; name: string; suggestions: string[] }

export function Analyst(props: {
  conversationId?: string;
  datasetName?: string;
  datasets: DatasetOption[];
  initialTurns: TurnView[];
  suggestions: string[];
  canAsk: boolean;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState(props.initialTurns);
  const [conversationId, setConversationId] = useState(props.conversationId);
  const [datasetId, setDatasetId] = useState(props.datasets[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<{ question: string; step: string; title?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns.length, pending?.step]);

  const suggestions = conversationId ? props.suggestions : props.datasets.find((d) => d.id === datasetId)?.suggestions ?? [];

  async function ask(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    setError(null);
    setQuestion("");
    setPending({ question: q, step: "planning" });
    let newConversation: string | undefined;
    try {
      const res = await fetch("/api/analyst/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(conversationId ? { question: q, conversationId } : { question: q, datasetId }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "The analyst couldn't start. Try again.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as StreamEvent;
          if (e.type === "started" && !conversationId) newConversation = e.conversationId;
          else if (e.type === "status") setPending((p) => p && { ...p, step: e.step === "validating" ? "planning" : e.step });
          else if (e.type === "plan") setPending((p) => p && { ...p, title: e.title });
          else if (e.type === "done") setTurns((t) => [...t, e.turn]);
          else if (e.type === "error") setError(e.message);
        }
      }
    } catch (err) {
      setError((err as Error).message);
      setQuestion(q);
    } finally {
      setPending(null);
      if (newConversation) {
        setConversationId(newConversation);
        router.replace(`/analyst/${newConversation}`, { scroll: false });
      }
      router.refresh();
    }
  }

  const stepIndex = pending ? STEPS.findIndex((s) => s.key === pending.step) : -1;

  return (
    <div className="flex min-h-[calc(100dvh-1px)] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4 lg:px-10">
        {conversationId ? (
          <p className="text-sm text-ink-soft">Dataset: <span className="font-semibold text-ink">{props.datasetName}</span></p>
        ) : (
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            Dataset
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} className="rounded border border-line bg-paper-raised px-2 py-1.5 text-ink">
              {props.datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="flex-1 space-y-6 px-6 py-6 lg:px-10">
        {turns.length === 0 && !pending ? (
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold">Ask a question about your data</h2>
            <p className="mt-1 text-ink-soft">Every number in an answer is calculated from your dataset, not estimated by the AI.</p>
          </div>
        ) : null}
        {turns.map((t) => (
          <div key={t.requestId} className="max-w-4xl space-y-3">
            <Question text={t.question} />
            <TurnCard turn={t} />
          </div>
        ))}
        {pending ? (
          <div className="max-w-4xl space-y-3">
            <Question text={pending.question} />
            <div className="rounded-lg border border-line bg-paper-raised px-5 py-4" role="status" aria-live="polite">
              {pending.title ? <p className="mb-2 text-sm font-medium text-ink-muted">{pending.title}</p> : null}
              <ol className="space-y-1.5 text-sm">
                {STEPS.map((s, i) => (
                  <li key={s.key} className={i < stepIndex ? "text-up" : i === stepIndex ? "font-medium text-ink" : "text-ink-muted"}>
                    <span aria-hidden className="inline-block w-5">{i < stepIndex ? "✓" : i === stepIndex ? "›" : "·"}</span>{s.label}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : null}
        {error ? <p role="alert" className="max-w-4xl rounded border border-down/30 bg-down/5 px-4 py-3 text-sm text-down">{error}</p> : null}
        <div ref={bottom} />
      </div>

      <div className="sticky bottom-0 border-t border-line bg-paper px-6 py-4 lg:px-10">
        {props.canAsk ? (
          <div className="max-w-4xl">
            {suggestions.length && !pending ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-line bg-paper-raised px-3 py-1 text-sm text-ink-soft hover:border-signal hover:text-signal">{s}</button>
                ))}
              </div>
            ) : null}
            <form onSubmit={(e) => { e.preventDefault(); ask(question); }} className="flex gap-2">
              <label htmlFor="question" className="sr-only">Your question</label>
              <input
                id="question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={Boolean(pending) || (!conversationId && !datasetId)}
                maxLength={1000}
                placeholder={turns.length ? "Ask a follow-up…" : "For example: Why did revenue decrease last month?"}
                className="min-w-0 flex-1 rounded border border-line bg-paper-raised px-3 py-2.5 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/25"
              />
              <button type="submit" disabled={Boolean(pending) || question.trim().length < 3} className="rounded bg-signal px-4 py-2.5 text-sm font-semibold text-white hover:bg-signal-hover disabled:opacity-50">
                Ask
              </button>
            </form>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">Viewers can read analyses but not ask new questions.</p>
        )}
      </div>
    </div>
  );
}
