// Upload rules shared by the browser (fast feedback) and the server (enforcement).
// The data engine re-checks everything, including file contents.

export const MAX_UPLOAD_MB = 50;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ["csv", "xlsx", "json", "jsonl", "parquet"] as const;
export const ACCEPT_ATTRIBUTE = ".csv,.xlsx,.json,.jsonl,.parquet";
// Temporary per-workspace cap until plan limits arrive with billing (Phase 9).
export const MAX_DATASETS_PER_WORKSPACE = 50;

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function checkUpload(file: { name: string; size: number }): string | null {
  const ext = extensionOf(file.name);
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return ext === "xls"
      ? "Older .xls files aren't supported. Open the file in Excel and save it as .xlsx."
      : "Upload a CSV, Excel (.xlsx), JSON or Parquet file.";
  }
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return `The file is larger than ${MAX_UPLOAD_MB} MB.`;
  if (file.name.length > 255) return "The file name is too long.";
  return null;
}

/** "Q3 sales_2026-final.csv" -> "Q3 sales 2026-final" */
export function datasetNameFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (stem || "Untitled dataset").slice(0, 120);
}
