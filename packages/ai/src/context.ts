/** What the planner is told about a dataset: structure and roles, a few sample values.
 * Column names and values come from an uploaded file, so they are untrusted text. */
import type { ColumnProfile, DatasetProfile } from "@insight/types";

export interface ContextColumn {
  name: string;
  type: string;
  role: string;
  concept: string | null;
  values?: string[]; // a few existing values for categories, to match user wording
  range?: [string | number | null, string | number | null];
  granularity?: string | null;
}

export interface DatasetContext {
  name: string;
  rows: number;
  columns: ContextColumn[];
}

export function buildContext(name: string, profile: DatasetProfile): DatasetContext {
  return {
    name,
    rows: profile.row_count,
    columns: profile.columns.map((c: ColumnProfile) => {
      const s = c.stats as Record<string, any>;
      const col: ContextColumn = { name: c.name, type: c.logical_type, role: c.role.role, concept: c.role.concept };
      if (c.logical_type === "numeric") col.range = [s.min ?? null, s.max ?? null];
      if (c.logical_type === "datetime") {
        col.range = [s.min ?? null, s.max ?? null];
        col.granularity = s.granularity ?? null;
      }
      if (["categorical", "boolean"].includes(c.logical_type) && Array.isArray(s.top_values)) {
        col.values = s.top_values.map((t: { value: string }) => String(t.value).slice(0, 60)).slice(0, 8);
      }
      return col;
    }),
  };
}

export const NUMERIC_TYPES = new Set(["numeric"]);
export const GROUPABLE_TYPES = new Set(["categorical", "identifier", "boolean", "text"]);
