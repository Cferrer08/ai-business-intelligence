const int = new Intl.NumberFormat("en-US");
const dec = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const formatInt = (n: number | null | undefined) => (n == null ? "—" : int.format(n));

export function formatNumber(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${dec.format(n / 1e9)}B`;
  if (abs >= 1e6) return `${dec.format(n / 1e6)}M`;
  if (abs >= 1e4) return int.format(Math.round(n));
  return dec.format(n);
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n > 0 && n < 0.1) return "<0.1%";
  return `${n.toFixed(digits).replace(/\.0+$/, "")}%`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(d: Date | string, withTime = false): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", withTime
    ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" });
}

/** Matches the data engine's fact formatting exactly, so a value reads the same in the
 * explanation and in the table. */
export function formatMetric(n: unknown, format: string): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (format === "percent") return `${n.toFixed(1)}%`;
  if (Math.abs(n) >= 10_000) return int.format(Math.round(n));
  if (format === "money") return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return dec.format(n);
}
