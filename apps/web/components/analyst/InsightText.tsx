import type { Segment } from "@insight/ai";

/** Text with engine-calculated values set apart from the AI's wording. */
export function InsightText({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.factId ? (
          <span key={i} className="num rounded-sm bg-signal-tint px-1 font-semibold text-ink" data-fact={s.factId}>{s.text}</span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
