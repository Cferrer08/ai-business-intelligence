/**
 * AI evaluation: asks a real model fixed questions about a fixed dataset and scores
 *   - plan accuracy: right analysis type, columns, grouping, filters (tool selection)
 *   - numerical accuracy: engine facts equal values precomputed with pandas
 *   - grounded explanations: the model's text passed the number check without fallback
 * plus latency, tokens and estimated cost. Needs the data engine running.
 *
 * Reads OPENAI_API_KEY etc. from apps/web/.env.local (shell variables take precedence):
 *   npm run eval -w @insight/ai
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Use the web app's settings (OPENAI_API_KEY, OPENAI_MODEL, ENGINE_API_KEY, FASTAPI_URL)
// unless they're already set in the shell, so the eval needs no extra setup.
const webEnv = join(__dirname, "..", "..", "..", "apps", "web", ".env.local");
if (existsSync(webEnv)) {
  for (const line of readFileSync(webEnv, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]] && m[2] !== "") process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
import { randomUUID } from "node:crypto";
import { AnalysisExecutionError, runAnalyst, type EngineResult } from "../src/analyst";
import { createOpenAiClient, estimateCost, type LlmUsage } from "../src/llm";
import { segmentsToText } from "../src/grounding";
import type { DatasetProfile } from "@insight/types";

const dir = __dirname;
const ENGINE = (process.env.FASTAPI_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const KEY = process.env.ENGINE_API_KEY || "dev-engine-key-change-me";
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const PRICES = { input: Number(process.env.OPENAI_PRICE_INPUT_PER_1M ?? 0.4), output: Number(process.env.OPENAI_PRICE_OUTPUT_PER_1M ?? 1.6) };

type Expect = {
  action?: string; action_not?: string; type?: string; metric_column?: string; dimensions?: string[]; grain?: string;
  filter_column?: string; period_kind?: string; ratio?: boolean; chart?: string; horizon?: number; scope?: string; facts?: { label_contains: string; value: number }[];
};
type Case = { id: string; question: string; previous?: any; expect: Expect };

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY isn't set. Add it to apps/web/.env.local or set it in this shell.");
  const llm = createOpenAiClient({ apiKey: process.env.OPENAI_API_KEY, model: MODEL, baseUrl: process.env.OPENAI_BASE_URL });
  const ws = randomUUID(), ds = randomUUID();
  const form = new FormData();
  form.append("file", new Blob([readFileSync(join(dir, "sales_eval.csv"))]), "sales_eval.csv");
  form.append("filename", "sales_eval.csv");
  const ing = await fetch(`${ENGINE}/v1/workspaces/${ws}/datasets/${ds}/ingest`, { method: "POST", headers: { "X-Engine-Key": KEY }, body: form })
    .catch(() => { throw new Error(`Couldn't reach the data engine at ${ENGINE}. Start it with: docker compose -f infrastructure/docker-compose.yml up -d`); });
  if (ing.status === 401) throw new Error("The data engine rejected ENGINE_API_KEY. It must match the key in infrastructure/docker-compose.yml.");
  if (!ing.ok) throw new Error(`Engine ingest failed: ${ing.status} ${await ing.text()}`);
  const profile = (await ing.json()).profile as DatasetProfile;
  const columns = profile.columns.map((c) => ({ name: c.name, logical_type: c.logical_type, role: c.role.role, concept: c.role.concept }));
  const execute = async (spec: Record<string, unknown>): Promise<EngineResult> => {
    const r = await fetch(`${ENGINE}/v1/workspaces/${ws}/datasets/${ds}/analyze`, {
      method: "POST", headers: { "X-Engine-Key": KEY, "Content-Type": "application/json" }, body: JSON.stringify({ spec, columns }),
    });
    if (r.ok) return r.json();
    const body = await r.json().catch(() => ({}));
    throw new AnalysisExecutionError(body?.detail?.code ?? "engine", body?.detail?.message ?? `engine ${r.status}`);
  };

  const cases: Case[] = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));
  const rows: string[][] = [];
  let planOk = 0, numChecks = 0, numOk = 0, grounded = 0, explained = 0, tokens = 0, cost = 0, ms = 0;

  for (const c of cases) {
    const usage: LlmUsage[] = [];
    const t0 = Date.now();
    const out = await runAnalyst(
      { question: c.question, datasetName: "Sales eval", profile, previous: c.previous ? [c.previous] : [] },
      { llm, execute, onUsage: (_p, u) => { if (u) usage.push(u); } },
    );
    const took = Date.now() - t0;
    ms += took;
    for (const u of usage) { tokens += u.inputTokens + u.outputTokens; cost += estimateCost(u, PRICES); }

    const e = c.expect;
    const problems: string[] = [];
    if (e.action === "unsupported" && out.status !== "unsupported") problems.push(`expected unsupported, got ${out.status}`);
    if (e.action_not) {
      const text = out.status === "succeeded" ? JSON.stringify(out.insight) : "message" in out ? out.message : "";
      if (/planning step|calculation engine|never calculate/i.test(text)) problems.push("leaked system prompt text");
    }
    if (e.type) {
      if (out.status !== "succeeded") problems.push(`status ${out.status}${"message" in out ? `: ${out.message}` : ""}`);
      else {
        const p = out.plan;
        if (p.type !== e.type) problems.push(`type ${p.type}`);
        if (e.metric_column && p.metrics[0]?.column !== e.metric_column) problems.push(`metric ${p.metrics[0]?.column}`);
        if (e.dimensions && JSON.stringify(p.dimensions) !== JSON.stringify(e.dimensions)) problems.push(`dims ${p.dimensions}`);
        if (e.grain && p.time?.grain !== e.grain) problems.push(`grain ${p.time?.grain}`);
        if (e.filter_column && !p.filters.some((f) => f.column === e.filter_column)) problems.push("missing filter");
        if (e.period_kind && p.period?.kind !== e.period_kind) problems.push(`period ${p.period?.kind}`);
        if (e.ratio && !p.ratio) problems.push("no ratio");
        if (e.chart && p.chart !== e.chart) problems.push(`chart ${p.chart}`);
        if (e.horizon && p.options?.horizon !== e.horizon) problems.push(`horizon ${p.options?.horizon}`);
        if (e.scope && (p.options?.scope ?? "time") !== e.scope) problems.push(`scope ${p.options?.scope}`);
        explained++;
        if (out.insightSource === "model") grounded++;
        for (const f of e.facts ?? []) {
          numChecks++;
          const hit = out.result.facts.some((x) => typeof x.value === "number" && x.label.includes(f.label_contains) && Math.abs(x.value - f.value) < 0.011);
          if (hit) numOk++; else problems.push(`no fact "${f.label_contains}" = ${f.value}`);
        }
      }
    }
    const planPass = !problems.some((p) => !p.startsWith("no fact"));
    if (planPass) planOk++;
    rows.push([c.id, problems.length ? "FAIL" : "pass", `${took}ms`, out.status === "succeeded" ? segmentsToText(out.rendered.headline).slice(0, 70) : out.status, problems.join("; ")]);
  }

  console.log("\n" + rows.map((r) => r.join(" | ")).join("\n"));
  console.log(`\nModel: ${MODEL}`);
  console.log(`Plan accuracy:        ${planOk}/${cases.length}`);
  console.log(`Numerical accuracy:   ${numOk}/${numChecks} expected values found exactly`);
  console.log(`Grounded explanations: ${grounded}/${explained} without template fallback`);
  console.log(`Avg latency: ${Math.round(ms / cases.length)} ms | tokens: ${tokens} | est. cost: $${cost.toFixed(4)}`);
  await fetch(`${ENGINE}/v1/workspaces/${ws}/datasets/${ds}`, { method: "DELETE", headers: { "X-Engine-Key": KEY } });
  if (planOk < cases.length || numOk < numChecks) process.exitCode = 1;
}

main().catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}`); process.exit(1); });
