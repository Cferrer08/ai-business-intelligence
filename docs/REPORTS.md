# Business reports (Phase 7)

**Reports → Generate business report** builds a full report from one dataset in about 10–30
seconds. Every figure is calculated by the data engine; the report is a saved snapshot.

## Sections

| Section | Engine analysis | Needs |
| --- | --- | --- |
| Executive summary | AI from all sections' facts (template if no AI) | — |
| Key figures | overview: totals, distinct customers/orders, latest complete month vs before | — |
| Revenue by month | monthly totals (a month still in progress is labelled "(partial)" and left out of trend figures) | date + revenue |
| Is revenue growing? | Mann-Kendall + Theil–Sen trend | date + revenue |
| What changed last month | latest complete month vs the one before, contributors by region and product | date + revenue |
| Product performance | top 10 products or categories | product/category column |
| Regional performance | revenue by region | region column |
| Customer segments | RFM segments | customer id |
| Unusual days / periods | robust baseline anomalies | date + revenue |
| Regions with an unusual month | groups vs the typical group's movement | region column |
| Forecast | backtested forecast, 3 months | date + revenue, 8+ months |
| Key risks, Recommended actions | AI from the facts; actions labelled as suggestions | AI key for actions |

Sections that don't apply are listed under "Not included" with the reason. Section analyses
run in parallel. Facts are renumbered across the report so every `{fN}` placeholder is unique,
and the AI summary goes through the same grounding check as the analyst (one retry, then a
template summary that never invents recommendations).

## Exports and sharing

- **PDF**: rendered by the data engine with ReportLab (vector charts, selectable text, page
  numbers). The web app sends finished text and figures; the renderer reads no data.
- **Key figures (CSV)**: every fact in the report (section, measure, value, as shown), with
  formula-like text neutralised.
- **Share link**: a random 256-bit token; only its SHA-256 is stored, so a link can be shown
  once and can't be recovered from the database. "Turn off sharing" (or deleting the report)
  revokes it immediately; creating a new link replaces the old one. Shared pages are
  read-only, `noindex`, show nothing else from the workspace, and their PDF downloads are
  rate-limited.
