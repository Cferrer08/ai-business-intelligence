/**
 * The analysis plan: the only thing the planner model may produce. It is a strict JSON
 * schema (enforced by the model API) and a Zod schema (enforced here), and it maps 1:1 to
 * the engine's Pydantic AnalysisSpec. The model chooses an operation and parameters; it
 * never writes code or numbers.
 */
import { z } from "zod";

const AGGS = ["sum", "mean", "median", "count", "count_distinct", "min", "max"] as const;
const GRAINS = ["day", "week", "month", "quarter", "year"] as const;
const OPS = ["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "between", "contains"] as const;

export const metricSchema = z.object({
  column: z.string().max(120).nullable(),
  agg: z.enum(AGGS),
  label: z.string().min(1).max(80),
});

export const CHART_TYPES = ["auto", "line", "bar", "donut", "scatter", "histogram", "table"] as const;

export const analysisSpecSchema = z.object({
  type: z.enum(["aggregate", "compare_periods", "overview", "distribution"]),
  metrics: z.array(metricSchema).max(3),
  ratio: z.object({ numerator: z.number().int().min(0).max(2), denominator: z.number().int().min(0).max(2), label: z.string().min(1).max(80), as_percent: z.boolean() }).nullable(),
  dimensions: z.array(z.string().max(120)).max(2),
  time: z.object({ column: z.string().max(120), grain: z.enum(GRAINS).nullable() }).nullable(),
  filters: z.array(z.object({ column: z.string().max(120), op: z.enum(OPS), values: z.array(z.string().max(200)).min(1).max(50) })).max(10),
  period: z.object({ kind: z.enum(["all", "latest", "latest_complete", "absolute"]), unit: z.enum(GRAINS).nullable(), start: z.string().nullable(), end: z.string().nullable() }).nullable(),
  comparison: z.enum(["previous_period", "same_period_last_year"]).nullable(),
  sort: z.object({ by: z.string().max(120), direction: z.enum(["asc", "desc"]) }).nullable(),
  limit: z.number().int().min(1).max(500).nullable(),
  // Only set when the user asks for a chart type; the app checks it suits the data.
  chart: z.enum(CHART_TYPES).nullable(),
});
export type AnalysisSpec = z.infer<typeof analysisSpecSchema>;

export const planSchema = z.object({
  action: z.enum(["analyze", "clarify", "unsupported"]),
  message: z.string().max(600).nullable(),
  title: z.string().min(1).max(120),
  analysis: analysisSpecSchema.nullable(),
});
export type Plan = z.infer<typeof planSchema>;

// ---- JSON schema for the model API (strict mode: every key required, nulls explicit) ----

const str = { type: "string" };
const nullable = (s: object) => ({ anyOf: [s, { type: "null" }] });
const obj = (properties: Record<string, object>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const analysisJson = obj({
  type: { type: "string", enum: ["aggregate", "compare_periods", "overview", "distribution"] },
  metrics: { type: "array", items: obj({ column: nullable(str), agg: { type: "string", enum: AGGS }, label: str }) },
  ratio: nullable(obj({ numerator: { type: "integer" }, denominator: { type: "integer" }, label: str, as_percent: { type: "boolean" } })),
  dimensions: { type: "array", items: str },
  time: nullable(obj({ column: str, grain: nullable({ type: "string", enum: GRAINS }) })),
  filters: { type: "array", items: obj({ column: str, op: { type: "string", enum: OPS }, values: { type: "array", items: str } }) },
  period: nullable(obj({ kind: { type: "string", enum: ["all", "latest", "latest_complete", "absolute"] }, unit: nullable({ type: "string", enum: GRAINS }), start: nullable(str), end: nullable(str) })),
  comparison: nullable({ type: "string", enum: ["previous_period", "same_period_last_year"] }),
  sort: nullable(obj({ by: str, direction: { type: "string", enum: ["asc", "desc"] } })),
  limit: nullable({ type: "integer" }),
  chart: nullable({ type: "string", enum: CHART_TYPES }),
});

export const planJsonSchema = obj({
  action: { type: "string", enum: ["analyze", "clarify", "unsupported"] },
  message: nullable(str),
  title: str,
  analysis: nullable(analysisJson),
});

// ---- Explanation contract ----

export const insightSchema = z.object({
  headline: z.string().min(1).max(300),
  what_happened: z.array(z.string().max(400)).max(6),
  why: z.array(z.string().max(400)).max(5),
  recommendations: z.array(z.object({ action: z.string().max(300), reason: z.string().max(300) })).max(4),
  caveats: z.array(z.string().max(300)).max(4),
});
export type Insight = z.infer<typeof insightSchema>;

export const insightJsonSchema = obj({
  headline: str,
  what_happened: { type: "array", items: str },
  why: { type: "array", items: str },
  recommendations: { type: "array", items: obj({ action: str, reason: str }) },
  caveats: { type: "array", items: str },
});
