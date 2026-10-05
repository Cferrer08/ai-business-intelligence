/**
 * The explanation may only state numbers through fact placeholders like {f3}. This module
 * checks that rule and renders the text, so every figure a user reads was computed by the
 * data engine.
 */
import type { DocumentNote, Insight } from "./plan";
import type { Passage } from "./embeddings";

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

// ---- Document statements ----

const NUMBER = /\d[\d,.]*%?/g;
const normNum = (s: string) => s.replace(/[,%]/g, "").replace(/\.0+$/, "").replace(/\.$/, "");

/**
 * Keeps only document statements that cite real passages and whose every number appears in
 * one of the cited passages ("30 days" must be in the policy text, not invented). Returns
 * the valid notes and the reasons others were dropped.
 */
export function checkDocumentNotes(notes: DocumentNote[], passages: Passage[]): { valid: DocumentNote[]; dropped: string[] } {
  const byId = new Map(passages.map((p) => [p.id, p]));
  const valid: DocumentNote[] = [];
  const dropped: string[] = [];
  for (const n of notes) {
    const cited = n.sources.map((s) => byId.get(s)).filter(Boolean) as Passage[];
    if (!cited.length) { dropped.push(`cites no known passage: "${n.text}"`); continue; }
    if (/\{f\d+\}/.test(n.text)) { dropped.push(`mixes calculated facts into a document statement: "${n.text}"`); continue; }
    const available = new Set(cited.flatMap((p) => (p.text.match(NUMBER) ?? []).map(normNum)));
    const missing = (n.text.match(NUMBER) ?? []).map(normNum).filter((x) => !available.has(x));
    if (missing.length) { dropped.push(`number ${missing[0]} isn't in the cited passage: "${n.text}"`); continue; }
    valid.push({ text: n.text, sources: cited.map((p) => p.id) });
  }
  return { valid, dropped };
}

export interface RenderedInsight {
  headline: Segment[];
  what_happened: Segment[][];
  why: Segment[][];
  recommendations: { action: Segment[]; reason: Segment[] }[];
  caveats: Segment[][];
  document_notes: DocumentNote[];
}

export function renderInsight(i: Insight, facts: Fact[]): RenderedInsight {
  const r = (t: string) => toSegments(t, facts);
  return {
    headline: r(i.headline),
    what_happened: i.what_happened.map(r),
    why: i.why.map(r),
    recommendations: i.recommendations.map((x) => ({ action: r(x.action), reason: r(x.reason) })),
    caveats: i.caveats.map(r),
    document_notes: i.document_notes ?? [],
  };
}

export const segmentsToText = (s: Segment[]) => s.map((x) => x.text).join("");
