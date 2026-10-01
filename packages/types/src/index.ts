// Shared types used by the web app today and the AI / data-engine layers later.

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

/** Result shape for server actions so the UI never sees raw errors. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

// ---------------------------------------------------------------------------
// Phase 2: dataset profiles, as produced by the Python data engine.
// ---------------------------------------------------------------------------

export type LogicalType = "numeric" | "datetime" | "boolean" | "categorical" | "text" | "identifier";
export type SemanticRole =
  | "time" | "monetary" | "quantity" | "identifier" | "geographic" | "category" | "metric" | "flag" | "text" | "unknown";

export interface ColumnRole {
  role: SemanticRole;
  concept: string | null;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  rejected: string[];
}

export interface ColumnProfile {
  name: string;
  position: number;
  logical_type: LogicalType;
  storage_type: string;
  is_integer: boolean;
  converted_from: string | null;
  invalid_count: number;
  non_null_count: number;
  missing_count: number;
  missing_pct: number;
  unique_count: number;
  unique_pct: number;
  stats: Record<string, unknown>;
  role: ColumnRole;
}

export interface QualityItem {
  factor: string;
  penalty: number;
  detail: string;
}

export interface DatasetProfile {
  row_count: number;
  column_count: number;
  type_counts: Partial<Record<LogicalType, number>>;
  missing_cells: number;
  missing_pct: number;
  duplicate_rows: number;
  quality: { score: number; breakdown: QualityItem[] };
  columns: ColumnProfile[];
  correlations: { a: string; b: string; spearman: number; pearson: number | null; direction: "positive" | "negative" }[];
  warnings: { level: "warning" | "info"; message: string; column: string | null }[];
  preview: { columns: string[]; rows: unknown[][] };
  profiling_ms: number;
}

export interface EngineIngestResponse {
  dataset_id: string;
  file_format: "csv" | "xlsx" | "json" | "parquet";
  size_bytes: number;
  read_notes: string[];
  encoding: string | null;
  delimiter: string | null;
  sheet: string | null;
  engine_version: string;
  profile: DatasetProfile;
}
