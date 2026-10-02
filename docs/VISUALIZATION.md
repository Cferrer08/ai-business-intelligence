# Visualization (Phase 4)

Charts are drawn only from numbers the data engine calculated. The chart for an analysis
is chosen by fixed rules from the shape of its result (`apps/web/lib/charts/build.ts`),
not by the language model, so a chart can never show a value that isn't in the result.

## Which chart, when

| Result | Default | Also offered |
| --- | --- | --- |
| Single totals | number cards | table |
| Metric over time | line | bar, table |
| Metric over time by a dimension | one line per value (largest 6) | bar, table |
| Metric by one dimension | bar (horizontal when labels are long or there are many) | pie, if the metric is a sum or count, all values ≥ 0, 2–8 groups and the list is complete; scatter, if there are two metrics; table |
| Metric by two dimensions | grouped bars (largest 6 of the second) | table |
| Period comparison | number cards + diverging bars of each group's change (green up, red down) | table |
| Distribution | histogram (one bar per value for small whole-number ranges) | table |
| Overview | number cards | table |

If the user asks for a chart type ("as a pie chart"), the planner records it and it's used
only if it's in the "also offered" list; otherwise the chart says why it wasn't used.
Maps aren't offered: region names alone don't carry coordinates.

## Controls

Every chart has: chart type switch, top 5 / top 10 / all for rankings, legend click to hide
a series, Expand (full screen, with a time-range slider on long series), Download as PNG
(2× resolution), SVG or CSV, Pin to dashboard, and "Show data" with the exact table.
CSV exports neutralise text starting with `=`, `+`, `-` or `@` so spreadsheets don't run
it as a formula, and include a byte-order mark so Excel opens UTF-8 correctly.

## Dashboard

- **Business overview**: the data engine computes revenue (or the main amount/quantity
  column), orders, customers and average order value for the **latest complete month**,
  with the change against the month before, from the newest dataset that has a date
  column and a money or quantity column (switchable). Orders count distinct order ids
  when a column is recognised, otherwise rows (and says so).
- **Trend**: monthly totals; a month still in progress is labelled "(partial)".
- **Biggest changes**: the groups (region, category) whose totals moved most between the
  two months. This is a calculation, not an AI judgement.
- **Pinned charts**: snapshots of analyses, redrawn from the stored result in the chart
  type and top-N the user pinned. They don't update when new data arrives; re-run the
  analysis for fresh numbers. Scheduled refreshes come with workflows (Phase 8).
- **Recent analyses**: the last five answers with a small preview.

## Consistency rule

A value reads the same everywhere: the engine's fact formatting and the web app's
`formatMetric` share one rule (two decimals below 10,000, whole numbers above, percentages
to one decimal). Tested in the end-to-end suites.
