/** A plain explanation built only from facts, used when the model's explanation can't be
 * validated or the model is unavailable. Always grounded; makes no recommendations. */
import type { Fact } from "./grounding";
import type { Insight } from "./plan";

const ph = (f?: Fact) => (f ? `{${f.id}}` : "");

export function templateInsight(type: string, facts: Fact[], title: string): Insight {
  const find = (p: (l: string) => boolean) => facts.find((f) => p(f.label));
  const out: Insight = { headline: title, what_happened: [], why: [], recommendations: [], caveats: [] };

  if (type === "compare_periods") {
    const cur = find((l) => l === "Current period");
    const base = find((l) => l === "Comparison period");
    const dir = find((l) => l === "Direction");
    const amount = find((l) => l.startsWith("Change in") && l.endsWith("(absolute amount)") && !l.includes(":"));
    const pct = find((l) => l.startsWith("Change in") && l.endsWith("(absolute percent)") && !l.includes(":"));
    const curVal = find((l) => l.endsWith(" in current period"));
    const baseVal = find((l) => l.endsWith(" in comparison period"));
    const metric = curVal?.label.replace(/ in current period$/, "") ?? "The metric";
    out.headline = `${metric} ${ph(dir)} by ${ph(pct ?? amount)} in ${ph(cur)} compared with ${ph(base)}.`;
    if (curVal && baseVal) out.what_happened.push(`${metric} was ${ph(curVal)} in ${ph(cur)}, compared with ${ph(baseVal)} in ${ph(base)}.`);
    if (amount) out.what_happened.push(`That is a change of ${ph(amount)}.`);
    for (const f of facts.filter((x) => x.label.includes(": change in") && x.label.endsWith("(absolute amount)")).slice(0, 3)) {
      const prefix = f.label.split(": change in")[0];
      const d = find((l) => l === `${prefix}: direction`);
      const share = find((l) => l === `${prefix}: share of the total change`);
      out.why.push(`${prefix} ${ph(d)} by ${ph(f)}${share ? `, ${ph(share)} of the total change` : ""}.`);
    }
    return out;
  }

  if (type === "distribution") {
    const med = find((l) => l.startsWith("Median "));
    const lo = find((l) => l.startsWith("Middle half of") && l.endsWith(" from"));
    const hi = find((l) => l.startsWith("Middle half of") && l.endsWith(" to"));
    const common = find((l) => l === "Most common range");
    const share = find((l) => l === "Share in the most common range");
    const metric = med?.label.replace(/^Median /, "") ?? "The value";
    out.headline = `The typical ${metric} is ${ph(med)}.`;
    if (lo && hi) out.what_happened.push(`The middle half of values fall between ${ph(lo)} and ${ph(hi)}.`);
    if (common && share) out.what_happened.push(`The most common range is ${ph(common)}, with ${ph(share)} of values.`);
    return out;
  }

  if (type === "aggregate") {
    const first = find((l) => l === "First period");
    const hiP = find((l) => l.startsWith("Highest") && l.endsWith(" period"));
    if (first && hiP) {
      const last = find((l) => l === "Last period");
      const hi = find((l) => l.startsWith("Highest") && !l.endsWith(" period"));
      const lo = find((l) => l.startsWith("Lowest") && !l.endsWith(" period"));
      const loP = find((l) => l.startsWith("Lowest") && l.endsWith(" period"));
      const change = find((l) => l.startsWith("Change in") && l.includes("first to last"));
      out.headline = `${title}: highest in ${ph(hiP)} at ${ph(hi)}.`;
      out.what_happened.push(`The lowest period was ${ph(loP)} at ${ph(lo)}.`);
      if (change && last) out.what_happened.push(`From ${ph(first)} to ${ph(last)} the change was ${ph(change)}.`);
      return out;
    }
    const rows = facts.filter((f) => f.label.includes(": ") && f.kind !== "text");
    if (rows[0]) {
      const [name, metric] = rows[0].label.split(": ");
      out.headline = name === "All rows" ? `${metric}: ${ph(rows[0])}.` : `${name} leads on ${metric} with ${ph(rows[0])}.`;
      for (const f of rows.slice(1, 4)) {
        const [n, m] = f.label.split(": ");
        out.what_happened.push(`${n}: ${m} ${ph(f)}.`);
      }
    }
    const total = find((l) => l.startsWith("Total "));
    if (total) out.what_happened.push(`${total.label}: ${ph(total)}.`);
    return out;
  }

  // overview
  const totals = facts.filter((f) => f.label.startsWith("Total ") || f.label.startsWith("Distinct "));
  const start = find((l) => l === "Data starts");
  const end = find((l) => l === "Data ends");
  out.headline = start && end ? `Summary of the data from ${ph(start)} to ${ph(end)}.` : "Summary of the data.";
  for (const f of totals.slice(0, 4)) out.what_happened.push(`${f.label}: ${ph(f)}.`);
  const latest = find((l) => l === "Latest complete month");
  const change = find((l) => l.includes("change vs month before"));
  if (latest && change) out.what_happened.push(`${change.label.split(" change")[0]} changed by ${ph(change)} in ${ph(latest)} compared with the month before.`);
  for (const f of facts.filter((x) => x.label.startsWith("Top ")).slice(0, 2)) {
    const share = find((l) => l === `${f.value}: share of total ${f.label.split(" by ")[1]}`);
    out.why.push(`${f.label}: ${ph(f)}${share ? `, ${ph(share)} of the total` : ""}.`);
  }
  return out;
}
