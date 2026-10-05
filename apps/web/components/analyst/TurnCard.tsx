import type { TurnView } from "@/lib/analyst/types";
import { describePlan } from "@/lib/analyst/describe";
import { formatInt } from "@/lib/format";
import { InsightText } from "./InsightText";
import { ResultTables } from "./ResultTables";
import { AnalysisChart } from "./AnalysisChart";
import { DocumentNotes } from "./DocumentNotes";
import type { Passage } from "@insight/ai";

export function Question({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] rounded-lg bg-ink px-4 py-2.5 text-white">{text}</p>
    </div>
  );
}

export function TurnCard({ turn }: { turn: TurnView }) {
  if (turn.status === "clarification" || turn.status === "unsupported" || turn.status === "failed" || turn.status === "not_found") {
    const tone = turn.status === "failed" ? "border-down/30 bg-down/5" : "border-line bg-paper-raised";
    return (
      <div className={`rounded-lg border px-5 py-4 ${tone}`}>
        <p className="text-sm font-medium text-ink-muted">
          {turn.status === "clarification" ? "A quick question first" : turn.status === "unsupported" ? "Not available yet" : turn.status === "not_found" ? "Not in your documents" : "Couldn't complete this analysis"}
        </p>
        <p className="mt-1">{turn.message}</p>
      </div>
    );
  }
  if (turn.status !== "succeeded" || !turn.rendered || !turn.result) return null;
  const r = turn.rendered;
  const passages = ((turn.result as { passages?: Passage[] }).passages ?? []);
  if (turn.result.type === "documents") {
    return (
      <article className="rounded-lg border border-line bg-paper-raised">
        <header className="border-b border-line px-5 py-4">
          <p className="text-sm font-medium text-ink-muted">Answer from your documents</p>
          <h3 className="mt-1 text-lg font-semibold leading-snug">{turn.title && turn.title !== "From your documents" ? turn.title : turn.question}</h3>
        </header>
        <div className="px-5 py-4"><DocumentNotes notes={r.document_notes} passages={passages} title="What your documents say" /></div>
      </article>
    );
  }
  return (
    <article className="rounded-lg border border-line bg-paper-raised">
      <header className="border-b border-line px-5 py-4">
        {turn.title ? <p className="text-sm font-medium text-ink-muted">{turn.title}</p> : null}
        <h3 className="mt-1 text-lg font-semibold leading-snug"><InsightText segments={r.headline} /></h3>
      </header>

      <div className="space-y-5 px-5 py-4">
        {r.what_happened.length ? (
          <section>
            <h4 className="text-sm font-semibold">What happened</h4>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-soft">{r.what_happened.map((s, i) => <li key={i}><InsightText segments={s} /></li>)}</ul>
          </section>
        ) : null}
        {r.why.length ? (
          <section>
            <h4 className="text-sm font-semibold">Contributing factors</h4>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-soft">{r.why.map((s, i) => <li key={i}><InsightText segments={s} /></li>)}</ul>
          </section>
        ) : null}
        {r.recommendations.length ? (
          <section className="rounded border border-dashed border-line bg-paper px-4 py-3">
            <h4 className="text-sm font-semibold">Suggested next steps <span className="font-normal text-ink-muted">(AI suggestions, not calculations)</span></h4>
            <ul className="mt-1.5 space-y-2 text-ink-soft">
              {r.recommendations.map((x, i) => (
                <li key={i}><span className="text-ink"><InsightText segments={x.action} /></span> <span className="text-sm">— <InsightText segments={x.reason} /></span></li>
              ))}
            </ul>
          </section>
        ) : null}

        <DocumentNotes notes={r.document_notes} passages={passages} title="From your documents" />

        <AnalysisChart turn={turn} table={<ResultTables result={turn.result} />} />

        {r.caveats.length ? (
          <ul className="space-y-1 text-sm text-ink-muted">{r.caveats.map((s, i) => <li key={i}>Note: <InsightText segments={s} /></li>)}</ul>
        ) : null}

        <details className="text-sm text-ink-soft">
          <summary className="cursor-pointer font-medium text-ink">How this was calculated</summary>
          <ul className="mt-2 space-y-1 pl-1">
            {turn.plan ? describePlan(turn.plan).map((l) => <li key={l}>{l}</li>) : null}
            {turn.result.rows_considered != null ? <li>Rows analysed: {formatInt(turn.result.rows_considered)}.</li> : null}
            <li>
              Highlighted numbers were calculated by the data engine from your dataset.{" "}
              {turn.insightSource === "template"
                ? "This summary was written from a template because the AI explanation didn't pass the number checks."
                : "The AI wrote the wording and suggestions around them."}
            </li>
          </ul>
        </details>
      </div>
    </article>
  );
}
