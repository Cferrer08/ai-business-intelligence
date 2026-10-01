import type { ColumnProfile } from "@insight/types";
import { formatDate, formatNumber, formatPct } from "@/lib/format";

const ROLE_LABEL: Record<string, string> = {
  time: "Date", monetary: "Money", quantity: "Quantity", identifier: "ID", geographic: "Location",
  category: "Category", metric: "Measure", flag: "Yes/no", text: "Text", unknown: "Unknown",
};

const TYPE_LABEL: Record<string, string> = {
  numeric: "Number", datetime: "Date", boolean: "Yes/no", categorical: "Category", text: "Text", identifier: "ID",
};

export const typeLabel = (c: ColumnProfile) =>
  c.logical_type === "numeric" ? (c.is_integer ? "Whole number" : "Decimal") : TYPE_LABEL[c.logical_type] ?? c.logical_type;

export function roleLabel(c: ColumnProfile): string {
  const base = ROLE_LABEL[c.role.role] ?? c.role.role;
  return c.role.concept && c.role.concept !== "date" ? `${base} · ${c.role.concept}` : base;
}

/** One-line, type-appropriate summary computed by the engine. */
export function columnSummary(c: ColumnProfile): string {
  const s = c.stats as Record<string, any>;
  switch (c.logical_type) {
    case "numeric":
      if (s.min == null) return "—";
      return `${formatNumber(s.min)} to ${formatNumber(s.max)}, median ${formatNumber(s.median)}` +
        (s.outlier_count ? `, ${formatNumber(s.outlier_count)} unusual` : "");
    case "datetime":
      if (!s.min) return "—";
      return `${formatDate(s.min)} to ${formatDate(s.max)}${s.granularity ? `, ${s.granularity}` : ""}`;
    case "boolean":
      return `${formatNumber(s.true_count)} yes, ${formatNumber(s.false_count)} no`;
    default: {
      const top = (s.top_values ?? []) as { value: string; share: number }[];
      // Mostly-unique columns (order numbers, emails): frequencies are meaningless, show examples.
      if (top.length && c.unique_pct >= 90) return `e.g. ${top.slice(0, 3).map((t) => t.value).join(", ")}`;
      if (!top.length) return s.min != null ? `${formatNumber(s.min)} to ${formatNumber(s.max)}` : "—";
      return top.slice(0, 3).map((t) => `${t.value} (${formatPct(t.share * 100, t.share < 0.01 ? 1 : 0)})`).join(", ");
    }
  }
}
