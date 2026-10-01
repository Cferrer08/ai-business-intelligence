import type { AnalysisSpec } from "@insight/ai";
import type { DatasetProfile } from "@insight/types";

const AGG: Record<string, string> = { sum: "Total", mean: "Average", median: "Median", count: "Count", count_distinct: "Number of distinct", min: "Lowest", max: "Highest" };
const PERIOD: Record<string, string> = { latest: "the latest", latest_complete: "the latest complete" };

/** Plain-English description of a plan, shown under "How this was calculated". */
export function describePlan(a: AnalysisSpec): string[] {
  const lines: string[] = [];
  if (a.type === "overview") lines.push("Overview of totals, date range, latest month and leading groups.");
  for (const m of a.metrics) lines.push(`${m.label}: ${AGG[m.agg]} ${m.column ? `of ${m.column}` : "of rows"}.`);
  if (a.ratio) lines.push(`${a.ratio.label}: ${a.metrics[a.ratio.numerator]?.label} ÷ ${a.metrics[a.ratio.denominator]?.label}${a.ratio.as_percent ? ", as a percentage" : ""}.`);
  if (a.time?.grain) lines.push(`By ${a.time.grain}, using ${a.time.column}.`);
  if (a.dimensions.length) lines.push(`${a.type === "compare_periods" ? "Change broken down by" : "Grouped by"} ${a.dimensions.join(" and ")}.`);
  if (a.period && a.period.kind !== "all") {
    const p = a.period.kind === "absolute" ? `${a.period.start} to ${a.period.end}` : `${PERIOD[a.period.kind]} ${a.period.unit} in the data`;
    lines.push(`Period: ${p}${a.comparison ? `, compared with ${a.comparison === "previous_period" ? "the period before" : "the same period a year earlier"}` : ""}.`);
  }
  for (const f of a.filters) lines.push(`Only rows where ${f.column} ${f.op.replace("_", " ")} ${f.values.join(", ")}.`);
  if (a.sort) lines.push(`Sorted by ${a.sort.by}, ${a.sort.direction === "desc" ? "highest" : "lowest"} first${a.limit ? `, top ${a.limit}` : ""}.`);
  return lines;
}

/** Starter questions built from the columns the profile recognised. */
export function suggestQuestions(profile: DatasetProfile): string[] {
  const role = (r: string, concept?: string) => profile.columns.find((c) => c.role.role === r && (!concept || c.role.concept === concept));
  const money = role("monetary", "revenue") ?? role("monetary") ?? role("quantity");
  const time = role("time");
  const geo = role("geographic");
  const customer = role("identifier", "customer");
  const product = profile.columns.find((c) => c.role.concept === "product");
  const category = role("category");
  const out: string[] = [];
  if (money && time) out.push(`Show monthly ${money.name} trends`, `Why did ${money.name} change last month?`);
  if (money && geo) out.push(`Which ${geo.name} has the highest ${money.name}?`);
  if (money && product) out.push(`What are the top 10 ${product.name} values by ${money.name}?`);
  else if (money && category) out.push(`Break down ${money.name} by ${category.name}`);
  if (money && customer) out.push(`Which customers generate the most ${money.name}?`);
  out.push("Summarize this dataset");
  return out.slice(0, 5);
}
