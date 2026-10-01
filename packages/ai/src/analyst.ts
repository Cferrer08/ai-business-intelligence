/**
 * The analyst pipeline:
 *   question → plan (model) → validate against dataset → compute (engine) → explain (model)
 *   → check that every number in the explanation is an engine fact → render.
 * Each step can repair once; if explaining fails, a template explanation is used so the
 * computed answer is never lost.
 */
import { buildContext, type DatasetContext } from "./context";
import { checkGrounding, renderInsight, type Fact, type RenderedInsight } from "./grounding";
import { LlmError, type LlmClient, type LlmUsage } from "./llm";
import { insightJsonSchema, insightSchema, planJsonSchema, planSchema, type AnalysisSpec, type Insight, type Plan } from "./plan";
import { INTERPRETER_SYSTEM, interpreterUser, PLANNER_SYSTEM, plannerUser } from "./prompts";
import { templateInsight } from "./fallback";
import { toEngineSpec, validatePlan } from "./validate";
import type { DatasetProfile } from "@insight/types";

export interface EngineResult {
  type: string;
  facts: Fact[];
  notes: string[];
  labels: string[];
  rows_considered?: number;
  [key: string]: unknown;
}

/** Thrown by the execute function for analysis problems the engine explained. */
export class AnalysisExecutionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
const FIXABLE = new Set(["unknown_column", "no_match", "not_numeric", "not_a_date", "bad_filter", "bad_period"]);

export type AnalystStep = "planning" | "validating" | "computing" | "explaining";
export type AnalystEvent =
  | { type: "status"; step: AnalystStep }
  | { type: "plan"; title: string; analysis: AnalysisSpec };

export interface PreviousTurn {
  question: string;
  plan: AnalysisSpec | null;
  headline: string | null;
}

export interface AnalystInput {
  question: string;
  datasetName: string;
  profile: DatasetProfile;
  previous: PreviousTurn[];
}

export interface AnalystDeps {
  llm: LlmClient;
  execute: (spec: Record<string, unknown>) => Promise<EngineResult>;
  onEvent?: (e: AnalystEvent) => void;
  onUsage?: (purpose: string, usage: LlmUsage | undefined, ok: boolean, errorCode?: string) => void | Promise<void>;
}

export type AnalystOutcome =
  | { status: "succeeded"; title: string; plan: AnalysisSpec; result: EngineResult; insight: Insight; rendered: RenderedInsight; insightSource: "model" | "template" }
  | { status: "clarification" | "unsupported"; title: string; message: string }
  | { status: "failed"; code: string; message: string; plan?: AnalysisSpec };

const MESSAGES: Record<string, string> = {
  auth: "The AI service rejected the API key. Check OPENAI_API_KEY.",
  rate_limit: "The AI service is busy or the usage limit was reached. Try again in a minute.",
  timeout: "The AI service took too long to respond. Try again.",
  unavailable: "The AI service isn't reachable right now. Try again shortly.",
  bad_response: "The AI returned an unexpected response. Try rephrasing the question.",
  refused: "The AI declined to answer this question.",
  invalid_plan: "I couldn't turn that question into a valid analysis of this dataset. Try naming the columns or period you mean.",
};

async function callModel<T>(deps: AnalystDeps, purpose: string, system: string, user: string, schemaName: string, jsonSchema: object, parse: (d: unknown) => T): Promise<T> {
  try {
    const { data, usage } = await deps.llm.completeJson({ purpose, system, user, schemaName, schema: jsonSchema });
    await deps.onUsage?.(purpose, usage, true);
    return parse(data);
  } catch (err) {
    if (err instanceof LlmError) await deps.onUsage?.(purpose, err.usage, false, err.code);
    throw err;
  }
}

async function plan(deps: AnalystDeps, ctx: DatasetContext, input: AnalystInput, repair?: string[]): Promise<{ plan: Plan | null; problems: string[] }> {
  const raw = await callModel(deps, repair ? "plan_repair" : "plan", PLANNER_SYSTEM, plannerUser(ctx, input.question, input.previous, repair), "analysis_plan", planJsonSchema, (d) => planSchema.safeParse(d));
  if (!raw.success) return { plan: null, problems: raw.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  return { plan: raw.data, problems: validatePlan(raw.data, ctx) };
}

export async function runAnalyst(input: AnalystInput, deps: AnalystDeps): Promise<AnalystOutcome> {
  const ctx = buildContext(input.datasetName, input.profile);
  try {
    // 1. Plan, with one repair attempt
    deps.onEvent?.({ type: "status", step: "planning" });
    let { plan: p, problems } = await plan(deps, ctx, input);
    deps.onEvent?.({ type: "status", step: "validating" });
    if (problems.length) ({ plan: p, problems } = await plan(deps, ctx, input, problems));
    if (!p || problems.length) return { status: "failed", code: "invalid_plan", message: MESSAGES.invalid_plan };
    if (p.action !== "analyze") return { status: p.action === "clarify" ? "clarification" : "unsupported", title: p.title, message: p.message ?? "" };

    // 2. Compute, with one repair attempt for problems the engine explained
    let analysis = p.analysis!;
    deps.onEvent?.({ type: "plan", title: p.title, analysis });
    deps.onEvent?.({ type: "status", step: "computing" });
    let result: EngineResult;
    try {
      result = await deps.execute(toEngineSpec(analysis));
    } catch (err) {
      if (!(err instanceof AnalysisExecutionError) || !FIXABLE.has(err.code)) throw err;
      const repaired = await plan(deps, ctx, input, [`The engine rejected the plan: ${err.message}`]);
      if (!repaired.plan || repaired.problems.length || repaired.plan.action !== "analyze") {
        return { status: "failed", code: err.code, message: err.message, plan: analysis };
      }
      p = repaired.plan;
      analysis = p.analysis!;
      deps.onEvent?.({ type: "plan", title: p.title, analysis });
      result = await deps.execute(toEngineSpec(analysis));
    }

    // 3. Explain, then check every number is an engine fact; retry once, else template
    deps.onEvent?.({ type: "status", step: "explaining" });
    const allowed = [
      ...result.labels, ...ctx.columns.map((c) => c.name), ...analysis.metrics.map((m) => m.label),
      ...(analysis.ratio ? [analysis.ratio.label] : []), input.datasetName, p.title,
    ];
    const shape = { type: result.type, dimensions: analysis.dimensions, labels: result.labels.slice(0, 30) };
    let insight: Insight | null = null;
    let source: "model" | "template" = "model";
    let repair: string[] | undefined;
    for (let attempt = 0; attempt < 2 && !insight; attempt++) {
      try {
        const parsed = await callModel(deps, attempt ? "interpret_retry" : "interpret", INTERPRETER_SYSTEM,
          interpreterUser(input.question, p.title, result.facts, result.notes, shape, repair), "insight", insightJsonSchema, (d) => insightSchema.safeParse(d));
        if (!parsed.success) { repair = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`); continue; }
        const issues = checkGrounding(parsed.data, result.facts, allowed);
        if (issues.length) { repair = issues; continue; }
        insight = parsed.data;
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        break; // the numbers are computed; explain them with the template rather than fail
      }
    }
    if (!insight) {
      insight = templateInsight(result.type, result.facts, p.title);
      source = "template";
    }
    // Engine notes (computed text, not model text) are always shown.
    insight.caveats = [...insight.caveats, ...result.notes.filter((n) => !insight!.caveats.includes(n))];
    return { status: "succeeded", title: p.title, plan: analysis, result, insight, rendered: renderInsight(insight, result.facts), insightSource: source };
  } catch (err) {
    if (err instanceof LlmError) return { status: "failed", code: err.code, message: MESSAGES[err.code] ?? MESSAGES.unavailable };
    if (err instanceof AnalysisExecutionError) return { status: "failed", code: err.code, message: err.message };
    throw err;
  }
}
