import type { DocumentNote, Passage } from "@insight/ai";

/** Statements from the workspace's documents, each with its sources. Visually distinct from
 * calculated facts (which are highlighted numbers); the cited passages can be expanded. */
export function DocumentNotes({ notes, passages, title }: { notes: DocumentNote[]; passages: Passage[]; title: string }) {
  if (!notes.length) return null;
  const byId = new Map(passages.map((p) => [p.id, p]));
  const cited = [...new Set(notes.flatMap((n) => n.sources))].map((id) => byId.get(id)).filter(Boolean) as Passage[];
  const num = (id: string) => cited.findIndex((p) => p.id === id) + 1;
  return (
    <section className="rounded border-l-4 border-ink-muted/40 bg-paper px-4 py-3" aria-label={title}>
      <h4 className="text-sm font-semibold">{title} <span className="font-normal text-ink-muted">(quoted from your files, not calculated)</span></h4>
      <ul className="mt-1.5 space-y-1.5 text-ink-soft">
        {notes.map((n, i) => (
          <li key={i} data-doc-note>
            {n.text}{" "}
            {n.sources.map((s) => <sup key={s} className="ml-0.5 font-semibold text-signal" title={byId.get(s)?.documentName}>[{num(s)}]</sup>)}
          </li>
        ))}
      </ul>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink">Sources</summary>
        <ol className="mt-2 space-y-2">
          {cited.map((p, i) => (
            <li key={p.id} className="rounded border border-line bg-paper-raised px-3 py-2">
              <p className="text-xs font-semibold">[{i + 1}] {p.documentName}{p.page ? `, ${p.page}` : ""}{p.heading ? ` · ${p.heading}` : ""}</p>
              <p className="mt-1 text-xs text-ink-soft">{p.text}</p>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
