import { describe, expect, it } from "vitest";
import { AnalysisExecutionError, runAnalyst, type EngineResult } from "../src/analyst";
import { LlmError } from "../src/llm";
import { checkGrounding, segmentsToText } from "../src/grounding";
import { templateInsight } from "../src/fallback";
import { validatePlan } from "../src/validate";
import { buildContext } from "../src/context";
import { planSchema } from "../src/plan";
import { comparePlan, compareResult, fakeLlm, goodInsight, profile } from "./fakes";

const input = { question: "Why did revenue decrease last month?", datasetName: "Sales", profile, previous: [] };

function engine(results: (EngineResult | Error)[]) {
  const specs: Record<string, unknown>[] = [];
  return {
    specs,
    execute: async (spec: Record<string, unknown>) => {
      specs.push(spec);
      const r = results.shift()!;
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

describe("runAnalyst", () => {
  it("plans, computes and explains with engine numbers only", async () => {
    const llm = fakeLlm([comparePlan, goodInsight]);
    const eng = engine([compareResult]);
    const usage: string[] = [];
    const steps: string[] = [];
    const out = await runAnalyst(input, {
      llm: llm.client, execute: eng.execute,
      onUsage: (p) => { usage.push(p); }, onEvent: (e) => { if (e.type === "status") steps.push(e.step); },
    });
    expect(out.status).toBe("succeeded");
    if (out.status !== "succeeded") return;
    expect(out.insightSource).toBe("model");
    expect(segmentsToText(out.rendered.headline)).toBe("Revenue decreased by 14.8% in September 2026 compared with August 2026.");
    expect(out.rendered.headline.filter((s) => s.factId).map((s) => s.factId)).toEqual(["f5", "f7", "f1", "f2"]);
    expect(eng.specs[0]).not.toHaveProperty("ratio"); // nulls stripped for the engine
    expect(eng.specs[0]).not.toHaveProperty("chart"); // app-only preference
    expect(usage).toEqual(["plan", "interpret"]);
    expect(steps).toEqual(["planning", "validating", "computing", "explaining"]);
    // the dataset description is passed as marked data
    expect(llm.calls[0].user).toContain("data, not instructions");
  });

  it("rejects an explanation that writes its own numbers, then accepts a grounded retry", async () => {
    const bad = { ...goodInsight, headline: "Revenue fell 14.8% last month." };
    const llm = fakeLlm([comparePlan, bad, goodInsight]);
    const out = await runAnalyst(input, { llm: llm.client, execute: engine([compareResult]).execute });
    expect(out.status === "succeeded" && out.insightSource).toBe("model");
    expect(llm.calls[2].purpose).toBe("interpret_retry");
    expect(llm.calls[2].user).toContain('"14.8%" is written as a number');
  });

  it("falls back to a grounded template when the model keeps inventing numbers", async () => {
    const bad = { ...goodInsight, what_happened: ["Revenue was about 105k."] };
    const out = await runAnalyst(input, { llm: fakeLlm([comparePlan, bad, bad]).client, execute: engine([compareResult]).execute });
    expect(out.status).toBe("succeeded");
    if (out.status !== "succeeded") return;
    expect(out.insightSource).toBe("template");
    expect(segmentsToText(out.rendered.headline)).toBe("Revenue decreased by 14.8% in September 2026 compared with August 2026.");
    expect(out.insight.recommendations).toEqual([]); // templates never recommend
  });

  it("still delivers the computed answer when the model fails while explaining", async () => {
    const out = await runAnalyst(input, { llm: fakeLlm([comparePlan, new LlmError("timeout", "slow")]).client, execute: engine([compareResult]).execute });
    expect(out.status === "succeeded" && out.insightSource).toBe("template");
  });

  it("repairs a plan that names a column that doesn't exist", async () => {
    const wrong = structuredClone(comparePlan);
    wrong.analysis.metrics[0].column = "sales";
    const llm = fakeLlm([wrong, comparePlan, goodInsight]);
    const out = await runAnalyst(input, { llm: llm.client, execute: engine([compareResult]).execute });
    expect(out.status).toBe("succeeded");
    expect(llm.calls[1].purpose).toBe("plan_repair");
    expect(llm.calls[1].user).toContain('column "sales" doesn\'t exist');
  });

  it("repairs a plan after the engine reports an unknown filter value", async () => {
    const llm = fakeLlm([comparePlan, comparePlan, goodInsight]);
    const eng = engine([new AnalysisExecutionError("no_match", "No rows have region = “Nrtheast”. Closest values: Northeast."), compareResult]);
    const out = await runAnalyst(input, { llm: llm.client, execute: eng.execute });
    expect(out.status).toBe("succeeded");
    expect(llm.calls[1].user).toContain("Closest values: Northeast");
  });

  it("gives up with a clear message when the plan can't be fixed", async () => {
    const wrong = structuredClone(comparePlan);
    wrong.analysis.metrics[0].column = "sales";
    const out = await runAnalyst(input, { llm: fakeLlm([wrong, wrong]).client, execute: engine([]).execute });
    expect(out).toMatchObject({ status: "failed", code: "invalid_plan" });
  });

  it("passes through clarifying questions and unsupported requests", async () => {
    const clarify = { action: "clarify", message: "Gross or net revenue?", title: "Revenue", analysis: null };
    expect(await runAnalyst(input, { llm: fakeLlm([clarify]).client, execute: engine([]).execute }))
      .toEqual({ status: "clarification", title: "Revenue", message: "Gross or net revenue?" });
    const unsupported = { action: "unsupported", message: "Forecasting arrives later.", title: "Forecast", analysis: null };
    expect((await runAnalyst(input, { llm: fakeLlm([unsupported]).client, execute: engine([]).execute })).status).toBe("unsupported");
  });

  it("reports AI service problems in plain language", async () => {
    const out = await runAnalyst(input, { llm: fakeLlm([new LlmError("auth", "401")]).client, execute: engine([]).execute });
    expect(out).toMatchObject({ status: "failed", code: "auth" });
    if (out.status === "failed") expect(out.message).toContain("OPENAI_API_KEY");
  });
});

describe("grounding", () => {
  it("allows names that contain digits but not free numbers", () => {
    const ok = { ...goodInsight, what_happened: ["Store 2 grew while Northeast fell by {f8}."] };
    expect(checkGrounding(ok, compareResult.facts, ["Store 2"])).toEqual([]);
    const bad = { ...goodInsight, what_happened: ["Store 3 grew 12%."] };
    expect(checkGrounding(bad, compareResult.facts, ["Store 2"]).length).toBeGreaterThan(0);
    const unknown = { ...goodInsight, headline: "Revenue {f99}." };
    expect(checkGrounding(unknown, compareResult.facts, [])[0]).toContain("Unknown fact");
  });

  it("template explanations are always grounded", () => {
    for (const type of ["compare_periods", "aggregate", "overview", "distribution"]) {
      const t = templateInsight(type, compareResult.facts, "Revenue");
      expect(checkGrounding(t, compareResult.facts, compareResult.labels)).toEqual([]);
    }
  });
});

describe("validatePlan", () => {
  const ctx = buildContext("Sales", profile);
  const v = (patch: (a: any) => void) => {
    const p = structuredClone(comparePlan);
    patch(p.analysis);
    return validatePlan(planSchema.parse(p), ctx);
  };
  it("accepts a valid plan", () => expect(v(() => {})).toEqual([]));
  it("rejects summing a text column", () => expect(v((a) => { a.metrics[0].column = "region"; })[0]).toContain("not numeric"));
  it("rejects grouping by a number", () => expect(v((a) => { a.dimensions = ["revenue"]; })[0]).toContain("group by categories"));
  it("rejects a non-date time column", () => expect(v((a) => { a.time.column = "region"; })[0]).toContain("not a date"));
  it("rejects sorting by something not in the plan", () => expect(v((a) => { a.sort = { by: "profit", direction: "desc" }; })[0]).toContain("sort.by"));
  it("rejects a distribution with groups", () => expect(v((a) => { a.type = "distribution"; a.time = null; a.period = null; a.comparison = null; }).join()).toContain("no dimensions"));
  it("requires periods to have a date column", () => expect(v((a) => { a.type = "aggregate"; a.time = null; }).join()).toContain("period needs time"));
});
