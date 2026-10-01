/**
 * The explanation may only state numbers through fact placeholders like {f3}. This module
 * checks that rule and renders the text, so every figure a user reads was computed by the
 * data engine.
 */
import type { Insight } from "./plan";

export interface Fact {
  id: string;
  label: string;
  kind: "number" | "money" | "percent" | "text";
  value: number | string | null;
  display: string;
}

export type Segment = { text: string; factId?: string };

const PLACEHOLDER = /\{(f\d+)\}/g;

function texts(i: Insight): string[] {
  return [i.headline, ...i.what_happened, ...i.why, ...i.recommendations.flatMap((r) => [r.action, r.reason]), ...i.caveats];
}

/** Returns problems; empty means the explanation is grounded. */
export function checkGrounding(insight: Insight, facts: Fact[], allowed: string[]): string[] {
  const ids = new Set(facts.map((f) => f.id));
  // Names that legitimately contain digits ("Store 2", "SKU-104", column names) are allowed verbatim.
  const allowedLower = [...allowed].filter((a) => /\d/.test(a)).sort((a, b) => b.length - a.length).map((a) => a.toLowerCase());
  const problems: string[] = [];
  for (const t of texts(insight)) {
    for (const m of t.matchAll(PLACEHOLDER)) if (!ids.has(m[1])) problems.push(`Unknown fact {${m[1]}} in: "${t}"`);
    let rest = t.replace(PLACEHOLDER, " ").toLowerCase();
    for (const a of allowedLower) rest = rest.split(a).join(" ");
    const digit = rest.match(/[^\s]*\d[^\s]*/);
    if (digit) problems.push(`"${digit[0]}" is written as a number. Use a fact placeholder instead, in: "${t}"`);
  }
  if (!insight.headline.trim()) problems.push("Headline is empty.");
  return problems;
}

export function toSegments(text: string, facts: Fact[]): Segment[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    const f = byId.get(m[1]);
    out.push(f ? { text: f.display, factId: f.id } : { text: "" });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export interface RenderedInsight {
  headline: Segment[];
  what_happened: Segment[][];
  why: Segment[][];
  recommendations: { action: Segment[]; reason: Segment[] }[];
  caveats: Segment[][];
}

export function renderInsight(i: Insight, facts: Fact[]): RenderedInsight {
  const r = (t: string) => toSegments(t, facts);
  return {
    headline: r(i.headline),
    what_happened: i.what_happened.map(r),
    why: i.why.map(r),
    recommendations: i.recommendations.map((x) => ({ action: r(x.action), reason: r(x.reason) })),
    caveats: i.caveats.map(r),
  };
}

export const segmentsToText = (s: Segment[]) => s.map((x) => x.text).join("");
