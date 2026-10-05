import type { DatasetProfile } from "@insight/types";
import { LlmError, type LlmCall, type LlmClient } from "../src/llm";
import type { EngineResult } from "../src/analyst";

/** Scripted model: returns queued responses in order and records each call. */
export function fakeLlm(responses: (unknown | LlmError)[]) {
  const calls: LlmCall[] = [];
  const client: LlmClient = {
    model: "fake-model",
    async completeJson(call) {
      calls.push(call);
      const next = responses.shift();
      if (next === undefined) throw new Error(`No scripted response for ${call.purpose}`);
      if (next instanceof LlmError) throw next;
      return { data: next, usage: { model: "fake-model", inputTokens: 100, outputTokens: 20, durationMs: 5 } };
    },
  };
  return { client, calls };
}

const col = (name: string, logical_type: string, role: string, concept: string | null, stats: object = {}) =>
  ({ name, position: 0, logical_type, storage_type: "", is_integer: false, converted_from: null, invalid_count: 0, non_null_count: 10, missing_count: 0, missing_pct: 0, unique_count: 5, unique_pct: 50, stats, role: { role, concept, confidence: "high", evidence: [], rejected: [] } });

export const profile = {
  row_count: 1000, column_count: 4, type_counts: {}, missing_cells: 0, missing_pct: 0, duplicate_rows: 0,
  quality: { score: 100, breakdown: [] }, correlations: [], warnings: [], preview: { columns: [], rows: [] }, profiling_ms: 1,
  columns: [
    col("order_date", "datetime", "time", "date", { min: "2026-01-01T00:00:00", max: "2026-09-30T00:00:00", granularity: "daily" }),
    col("region", "categorical", "geographic", "region", { top_values: [{ value: "Northeast" }, { value: "South" }, { value: "Store 2" }] }),
    col("revenue", "numeric", "monetary", "revenue", { min: 1, max: 900 }),
    col("customer_id", "identifier", "identifier", "customer"),
  ],
} as unknown as DatasetProfile;

export const comparePlan = {
  action: "analyze", message: null, title: "Revenue change last month",
  analysis: {
    type: "compare_periods", metrics: [{ column: "revenue", agg: "sum", label: "Revenue" }], ratio: null,
    dimensions: ["region"], time: { column: "order_date", grain: null }, filters: [],
    period: { kind: "latest_complete", unit: "month", start: null, end: null }, comparison: "previous_period", sort: null, limit: null, chart: null, options: null,
  },
};

export const compareResult: EngineResult = {
  type: "compare_periods",
  labels: ["Northeast", "South", "Store 2"],
  notes: [],
  facts: [
    { id: "f1", label: "Current period", kind: "text", value: "September 2026", display: "September 2026" },
    { id: "f2", label: "Comparison period", kind: "text", value: "August 2026", display: "August 2026" },
    { id: "f3", label: "Revenue in current period", kind: "money", value: 105000, display: "105,000" },
    { id: "f4", label: "Revenue in comparison period", kind: "money", value: 123240, display: "123,240" },
    { id: "f5", label: "Direction", kind: "text", value: "decreased", display: "decreased" },
    { id: "f6", label: "Change in Revenue (absolute amount)", kind: "money", value: 18240, display: "18,240" },
    { id: "f7", label: "Change in Revenue (absolute percent)", kind: "percent", value: 14.8, display: "14.8%" },
    { id: "f8", label: "region Northeast: change in Revenue (absolute amount)", kind: "money", value: 11430, display: "11,430" },
    { id: "f9", label: "region Northeast: direction", kind: "text", value: "decreased", display: "decreased" },
    { id: "f10", label: "region Northeast: share of the total change", kind: "percent", value: 62.7, display: "62.7%" },
  ],
};

export const goodInsight = {
  headline: "Revenue {f5} by {f7} in {f1} compared with {f2}.",
  what_happened: ["Revenue was {f3} in {f1}, down from {f4}."],
  why: ["Northeast accounted for {f10} of the decline, a drop of {f8}."],
  recommendations: [{ action: "Review Northeast pricing and stock levels.", reason: "Northeast contributed {f10} of the change." }],
  caveats: [],
  document_notes: [],
};
