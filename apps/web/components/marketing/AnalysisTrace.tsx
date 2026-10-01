// Illustrative example of an analysis, typeset the way the product presents results:
// calculated figures and AI interpretation are visibly separated.
const steps = [
  "Compared September with August",
  "Grouped revenue by category and region",
  "Ranked contributors to the change",
];

const contributors = [
  { label: "Category A", value: -18240 },
  { label: "Northeast region", value: -11430 },
  { label: "Customer segment B", value: -7820 },
];

const max = Math.max(...contributors.map((c) => Math.abs(c.value)));
const fmt = (n: number) => `−$${Math.abs(n).toLocaleString("en-US")}`;

export function AnalysisTrace() {
  return (
    <figure className="rounded-lg border border-line bg-paper-raised shadow-[0_1px_0_#D7DDE4,0_12px_32px_-16px_rgba(22,32,46,0.25)]">
      <div className="border-b border-line px-5 py-4">
        <p className="text-sm text-ink-muted">Example question</p>
        <p className="mt-0.5 text-lg font-semibold">Why did revenue decrease last month?</p>
      </div>

      <ol className="space-y-1.5 border-b border-line px-5 py-4 text-sm text-ink-soft">
        {steps.map((s) => (
          <li key={s} className="flex gap-2"><span aria-hidden className="text-up">✓</span>{s}</li>
        ))}
      </ol>

      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-ink-soft">Calculated</span>
          <span className="num text-2xl font-bold text-down">−14.8%</span>
        </div>
        <ul className="mt-4 space-y-3">
          {contributors.map((c) => (
            <li key={c.label}>
              <div className="flex justify-between text-sm">
                <span>{c.label}</span>
                <span className="num font-medium">{fmt(c.value)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-paper-sunk">
                <div className="h-1.5 rounded-full bg-down/80" style={{ width: `${(Math.abs(c.value) / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-b-lg border-t border-dashed border-line bg-signal-tint/50 px-5 py-4">
        <span className="text-sm font-medium text-signal">Interpretation</span>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          Most of the decline sits in Category A sales in the Northeast. Check inventory and pricing there before changing prices more broadly.
        </p>
      </div>
      <figcaption className="sr-only">Example analysis with sample figures</figcaption>
    </figure>
  );
}
