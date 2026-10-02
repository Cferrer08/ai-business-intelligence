/** Checks a plan against the dataset's real columns before anything runs.
 * Returns readable problems; the planner gets one chance to fix them. */
import type { AnalysisSpec, Plan } from "./plan";
import { GROUPABLE_TYPES, NUMERIC_TYPES, type DatasetContext } from "./context";

export function validatePlan(plan: Plan, ctx: DatasetContext): string[] {
  if (plan.action !== "analyze") return plan.message ? [] : ["A clarification or unsupported answer needs a message."];
  const a = plan.analysis;
  if (!a) return ["action is analyze but analysis is missing."];
  const cols = new Map(ctx.columns.map((c) => [c.name, c]));
  const problems: string[] = [];
  const col = (name: string, where: string) => {
    const c = cols.get(name);
    if (!c) problems.push(`${where}: column "${name}" doesn't exist. Use one of the listed column names exactly.`);
    return c;
  };

  if (a.type !== "overview" && a.metrics.length === 0) problems.push(`${a.type} needs at least one metric.`);
  if (a.type === "distribution" && (a.metrics.length !== 1 || a.metrics[0].column === null || a.dimensions.length)) {
    problems.push("distribution needs exactly one metric with a numeric column, and no dimensions.");
  }
  const labels = new Set<string>();
  a.metrics.forEach((m, i) => {
    if (labels.has(m.label)) problems.push(`metrics[${i}]: label "${m.label}" is used twice.`);
    labels.add(m.label);
    if (m.column === null) {
      if (m.agg !== "count") problems.push(`metrics[${i}]: ${m.agg} needs a column. Only "count" may have a null column (counts rows).`);
      return;
    }
    const c = col(m.column, `metrics[${i}]`);
    if (c && !["count", "count_distinct"].includes(m.agg) && !NUMERIC_TYPES.has(c.type)) {
      problems.push(`metrics[${i}]: "${m.column}" is ${c.type}, not numeric, so it can't use ${m.agg}. Use count or count_distinct, or a numeric column.`);
    }
  });
  if (a.ratio && Math.max(a.ratio.numerator, a.ratio.denominator) >= a.metrics.length) {
    problems.push("ratio: numerator and denominator must be indexes into metrics.");
  }
  a.dimensions.forEach((d, i) => {
    const c = col(d, `dimensions[${i}]`);
    if (c && !GROUPABLE_TYPES.has(c.type)) {
      problems.push(`dimensions[${i}]: "${d}" is ${c.type}; group by categories or ids. For dates, use time with a grain instead.`);
    }
  });
  if (a.time) {
    const c = col(a.time.column, "time");
    if (c && c.type !== "datetime") problems.push(`time: "${a.time.column}" is ${c.type}, not a date column.`);
  }
  if (a.type === "compare_periods") {
    if (!a.time) problems.push("compare_periods needs time (the date column).");
    if (!a.period || a.period.kind === "all") problems.push("compare_periods needs a period other than all.");
    if (!a.comparison) problems.push("compare_periods needs a comparison.");
  }
  if (a.period) {
    if ((a.period.kind === "latest" || a.period.kind === "latest_complete") && !a.period.unit) problems.push("period: relative periods need a unit.");
    if (a.period.kind === "absolute" && !(a.period.start && a.period.end)) problems.push("period: absolute periods need start and end dates (YYYY-MM-DD).");
    if (a.period.kind !== "all" && !a.time) problems.push("period needs time (the date column) to be set.");
  }
  a.filters.forEach((f, i) => {
    col(f.column, `filters[${i}]`);
    if (f.op === "between" && f.values.length !== 2) problems.push(`filters[${i}]: between needs exactly two values.`);
  });
  if (a.sort) {
    const ok = labels.has(a.sort.by) || a.dimensions.includes(a.sort.by) || (a.ratio && a.ratio.label === a.sort.by);
    if (!ok) problems.push(`sort.by "${a.sort.by}" must be a metric label, the ratio label, or a dimension.`);
  }
  return problems;
}

export function toEngineSpec(a: AnalysisSpec) {
  // Drop nulls the engine treats as absent; the chart preference is for the app only.
  const { chart: _chart, ...spec } = a;
  return JSON.parse(JSON.stringify(spec, (_k, v) => (v === null ? undefined : v)));
}
