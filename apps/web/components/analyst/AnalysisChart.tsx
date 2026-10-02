"use client";

import { useMemo, useState, useTransition } from "react";
import { buildChart } from "@/lib/charts/build";
import { ChartPanel } from "@/components/charts/ChartPanel";
import { pinChart } from "@/app/actions/charts";
import type { TurnView } from "@/lib/analyst/types";

export function AnalysisChart({ turn, table }: { turn: TurnView; table: React.ReactNode }) {
  const spec = useMemo(() => buildChart(turn.result!, turn.plan), [turn.result, turn.plan]);
  // pinned: saved as shown; changed: pinned, but the view has changed since (re-pin updates it)
  const [pin, setPin] = useState<"none" | "pinned" | "changed">(turn.pinned ? "pinned" : "none");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const title = turn.title ?? turn.question;

  return (
    <ChartPanel
      spec={spec}
      title={title}
      table={table}
      onChange={() => setPin((p) => (p === "pinned" ? "changed" : p))}
      actions={(state) =>
        turn.resultId ? (
          <>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => {
              const res = await pinChart({ resultId: turn.resultId!, chartType: state.type, topN: state.topN === 5 || state.topN === 10 ? state.topN : null });
              if (res.ok) { setPin("pinned"); setMessage(null); } else setMessage(res.error);
            })}
            className={`rounded border px-2.5 py-1 ${pin === "pinned" ? "border-signal bg-signal-tint text-signal" : "border-line bg-paper-raised text-ink-soft hover:text-ink"}`}
          >
            {pending ? "Pinning…" : pin === "pinned" ? "Pinned to dashboard" : pin === "changed" ? "Update pin" : "Pin to dashboard"}
          </button>
          {message ? <span role="alert" className="text-down">{message}</span> : null}
          </>
        ) : null
      }
    />
  );
}
