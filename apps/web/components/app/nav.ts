// Sidebar sections and the phase in which each becomes functional.
// Sections without a page yet render an honest "not built yet" screen instead of mock data.
/** Highest phase that is built. Sections from later phases show an honest placeholder. */
export const CURRENT_PHASE = 8;

export interface NavItem {
  href: string;
  label: string;
  phase: number;
  summary: string;
}

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", phase: 1, summary: "Business overview and recent analyses." },
  { href: "/data", label: "Data", phase: 2, summary: "Upload CSV, Excel, JSON and Parquet files, then review an automatic quality profile of each dataset." },
  { href: "/knowledge", label: "Knowledge", phase: 6, summary: "Business documents the AI Analyst can cite." },
  { href: "/analyst", label: "AI Analyst", phase: 3, summary: "Ask questions in plain English. Calculations run in the Python engine; the AI explains the results." },
  { href: "/reports", label: "Reports", phase: 7, summary: "Executive reports with charts, exportable to PDF and shareable by link." },
  { href: "/forecasts", label: "Forecasts", phase: 5, summary: "Forecast a metric with confidence intervals, using the simplest model that fits the data." },
  { href: "/anomalies", label: "Anomalies", phase: 5, summary: "Spikes, drops and unusual transactions, each with the reason it was flagged." },
  { href: "/workflows", label: "Workflows", phase: 8, summary: "Scheduled analyses such as a weekly business review or a daily briefing." },
  { href: "/analytics", label: "Analytics", phase: 5, summary: "Correlation, segmentation and trend analysis across your datasets." },
  { href: "/usage", label: "Usage", phase: 9, summary: "AI requests, tokens, cost and response time for this workspace." },
  { href: "/billing", label: "Billing", phase: 9, summary: "Plans, invoices and payment details, managed through Stripe." },
  { href: "/settings", label: "Settings", phase: 1, summary: "Workspace name and members." },
];

export const UPCOMING = Object.fromEntries(NAV.filter((n) => n.phase > CURRENT_PHASE).map((n) => [n.href.slice(1), n]));
