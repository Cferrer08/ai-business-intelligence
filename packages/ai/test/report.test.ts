import { describe, expect, it } from "vitest";
import { summarizeReport, templateSummary, type ReportSectionInput } from "../src/report";
import { checkGrounding } from "../src/grounding";
import { LlmError } from "../src/llm";
import { compareResult, fakeLlm } from "./fakes";

const sections: ReportSectionInput[] = [
  { key: "change_drivers", title: "What drove the change", type: "compare_periods", facts: compareResult.facts, notes: [], labels: compareResult.labels },
];
const good = { executive_summary: ["Revenue {f5} by {f7} in {f1}."], risks: ["Northeast accounted for {f10} of the decline."],
  actions: [{ action: "Review Northeast pricing.", reason: "It drove {f10} of the change." }] };

describe("report summary", () => {
  it("uses the model's grounded summary", async () => {
    const out = await summarizeReport(sections, fakeLlm([good]).client);
    expect(out.source).toBe("model");
    expect(out.actions).toHaveLength(1);
  });
  it("retries when a number is written directly, then falls back to the template", async () => {
    const bad = { ...good, executive_summary: ["Revenue fell 8% last month."] };
    const llm = fakeLlm([bad, bad]);
    const out = await summarizeReport(sections, llm.client);
    expect(out.source).toBe("template");
    expect(out.actions).toEqual([]);                      // the template never invents recommendations
    expect(llm.calls[1].purpose).toBe("report_summary_retry");
  });
  it("falls back when the model is unavailable or not configured", async () => {
    expect((await summarizeReport(sections, fakeLlm([new LlmError("timeout", "x")]).client)).source).toBe("template");
    expect((await summarizeReport(sections, null)).source).toBe("template");
  });
  it("template statements are grounded and include a decline as a risk", () => {
    const t = templateSummary(sections);
    expect(t.risks.join()).toContain("Revenue fell by {f7} in {f1}");
    const asInsight = { headline: t.executive_summary.join(" "), what_happened: t.risks, why: [], recommendations: [], caveats: [], document_notes: [] };
    expect(checkGrounding(asInsight, compareResult.facts, compareResult.labels)).toEqual([]);
  });
});
