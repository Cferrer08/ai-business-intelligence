import { describe, expect, it } from "vitest";
import { buildChart, chartCsv } from "@/lib/charts/build";

const agg = (columns: any[], rows: any[], extra: any = {}) => ({ type: "aggregate", facts: [], notes: [], labels: [], table: { columns, rows }, ...extra }) as any;
const plan = (patch: any = {}) => ({ type: "aggregate", metrics: [{ column: "revenue", agg: "sum", label: "Revenue" }], ratio: null, dimensions: [], time: null, filters: [], period: null, comparison: null, sort: null, limit: null, chart: null, ...patch });
const revenue = { key: "Revenue", label: "Revenue", kind: "metric", format: "money" };
const units = { key: "Units", label: "Units", kind: "metric", format: "number" };
const region = { key: "region", label: "region", kind: "dimension", format: "text" };
const month = { key: "order_date", label: "order_date", kind: "time", format: "date", grain: "month" };

describe("buildChart", () => {
  it("time series becomes a line chart in time order with month labels", () => {
    const s = buildChart(agg([month, revenue], [{ order_date: "2026-01-01T00:00:00", Revenue: 10 }, { order_date: "2026-02-01T00:00:00", Revenue: 12 }]), plan());
    expect(s.type).toBe("line");
    expect(s.data.map((d) => d.__x)).toEqual(["Jan 2026", "Feb 2026"]);
    expect(s.data.map((d) => d.Revenue)).toEqual([10, 12]);
  });

  it("category comparison is a bar chart; small complete additive breakdowns allow a donut", () => {
    const rows = [{ region: "NE", Revenue: 5 }, { region: "S", Revenue: 3 }, { region: "W", Revenue: 2 }];
    const s = buildChart(agg([region, revenue], rows, { groups_total: 3 }), plan());
    expect(s.type).toBe("bar");
    expect(s.options).toContain("donut");
  });

  it("no donut for averages, partial lists or negative values", () => {
    const rows = [{ region: "NE", Revenue: 5 }, { region: "S", Revenue: 3 }];
    expect(buildChart(agg([region, revenue], rows, { groups_total: 2 }), plan({ metrics: [{ column: "revenue", agg: "mean", label: "Revenue" }] })).options).not.toContain("donut");
    expect(buildChart(agg([region, revenue], rows, { groups_total: 9 }), plan()).options).not.toContain("donut");
    expect(buildChart(agg([region, revenue], [{ region: "NE", Revenue: -1 }, { region: "S", Revenue: 3 }], { groups_total: 2 }), plan()).options).not.toContain("donut");
  });

  it("honours a requested chart type only when it fits", () => {
    const rows = [{ region: "NE", Revenue: 5, Units: 1 }, { region: "S", Revenue: 3, Units: 2 }, { region: "W", Revenue: 2, Units: 4 }];
    expect(buildChart(agg([region, revenue, units], rows, { groups_total: 3 }), plan({ chart: "scatter" })).type).toBe("scatter");
    const s = buildChart(agg([month, revenue], [{ order_date: "2026-01-01", Revenue: 1 }]), plan({ chart: "donut" }));
    expect(s.type).toBe("line");
    expect(s.note).toContain("pie chart doesn't suit");
  });

  it("time by dimension pivots into one series per top value", () => {
    const rows = ["NE", "S", "W", "MW", "A", "B", "C"].flatMap((r, i) => [
      { order_date: "2026-01-01", region: r, Revenue: 100 - i }, { order_date: "2026-02-01", region: r, Revenue: 90 - i },
    ]);
    const s = buildChart(agg([month, region, revenue], rows), plan());
    expect(s.series.map((x) => x.key)).toEqual(["NE", "S", "W", "MW", "A", "B"]);
    expect(s.data).toHaveLength(2);
    expect(s.note).toContain("1 more");
  });

  it("single totals become number cards", () => {
    const s = buildChart(agg([revenue], [{ Revenue: 42 }]), plan());
    expect(s.type).toBe("kpi");
    expect(s.kpis[0]).toMatchObject({ label: "Revenue", value: 42, format: "money" });
  });

  it("period comparison shows a diverging bar of contributors", () => {
    const res = { type: "compare_periods", facts: [], notes: [], labels: [], period: { current: { label: "Sep" }, baseline: { label: "Aug" } },
      summary: { metric: "Revenue", format: "money", current: 90, baseline: 100, change: -10, change_pct: -10, other_metrics: [] },
      contributors: [{ dimension: "region", rows: [{ value: "NE", change: -12, share_of_change: 120 }, { value: "S", change: 2, share_of_change: -20 }] }] } as any;
    const s = buildChart(res, plan({ type: "compare_periods" }));
    expect(s.type).toBe("diverging");
    expect(s.data.map((d) => d.change)).toEqual([-12, 2]);
    expect(s.kpis[0].changePct).toBe(-10);
  });
});

describe("chartCsv", () => {
  it("exports the chart data and neutralises formula-like text", () => {
    const s = buildChart(agg([region, revenue], [{ region: "=HYPERLINK(evil)", Revenue: -5 }, { region: "S, Inc", Revenue: 3 }], { groups_total: 2 }), plan());
    const csv = chartCsv(s).split("\r\n");
    expect(csv[0]).toBe("region,Revenue");
    expect(csv[1]).toBe("'=HYPERLINK(evil),-5");
    expect(csv[2]).toBe('"S, Inc",3');
  });
});
