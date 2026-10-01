"""Data quality score (0–100) with an itemised breakdown.

Score = 100 minus capped penalties:
  sparse columns     2 points per column that is more than half empty, up to 10.
                     These are usually optional fields (notes, secondary phone) so they are
                     flagged, but excluded from the missing-cells and constant checks below.
  missing cells      2 points per 1% of empty cells in the remaining columns, up to 40
  duplicate rows     2 points per 1% of duplicated rows, up to 20
  unreadable values  2 points per column with values that don't fit its type, up to 10
  constant columns   3 points per column holding a single value, up to 15
  outliers           1 point per 1% of numeric values outside 1.5×IQR, up to 10

Every penalty in the breakdown names its cause, so the score is never a mystery.
"""
from __future__ import annotations

SPARSE_THRESHOLD_PCT = 50.0


def _names(cols: list[str]) -> str:
    return ", ".join(cols[:5]) + ("…" if len(cols) > 5 else "")


def quality_score(*, n_rows: int, n_cols: int, missing_cells: int, duplicate_rows: int,
                  columns: list[dict]) -> dict:
    items = []
    n_rows = max(1, n_rows)
    sparse = [c for c in columns if 100 * c["missing_count"] / n_rows > SPARSE_THRESHOLD_PCT]
    dense = [c for c in columns if c not in sparse]

    if sparse:
        items.append({"factor": "sparse_columns", "penalty": float(min(10, 2 * len(sparse))),
                      "detail": f"Mostly empty: {_names([c['name'] for c in sparse])}"})

    dense_cells = n_rows * len(dense)
    dense_missing = sum(c["missing_count"] for c in dense)
    if dense_missing and dense_cells:
        pct = 100 * dense_missing / dense_cells
        items.append({"factor": "missing_values", "penalty": round(min(40.0, pct * 2), 1),
                      "detail": f"{pct:.1f}% of cells are empty" + (" in the other columns" if sparse else "")})

    if duplicate_rows:
        pct = 100 * duplicate_rows / n_rows
        items.append({"factor": "duplicate_rows", "penalty": round(min(20.0, pct * 2), 1),
                      "detail": f"{duplicate_rows:,} duplicate rows ({pct:.2f}%)"})

    unreadable = [c["name"] for c in columns if c.get("invalid_count", 0) > 0]
    if unreadable:
        items.append({"factor": "unreadable_values", "penalty": float(min(10, 2 * len(unreadable))),
                      "detail": f"Values that don't match the column type in: {_names(unreadable)}"})

    flat = [c["name"] for c in dense if c["unique_count"] <= 1]
    if flat:
        items.append({"factor": "constant_columns", "penalty": float(min(15, 3 * len(flat))),
                      "detail": f"Same value in every row: {_names(flat)}"})

    numeric = [c for c in columns if c.get("stats", {}).get("outlier_count") is not None]
    numeric_cells = sum(c["non_null_count"] for c in numeric)
    outliers = sum(c["stats"]["outlier_count"] for c in numeric)
    if outliers and numeric_cells:
        pct = 100 * outliers / numeric_cells
        items.append({"factor": "outliers", "penalty": round(min(10.0, pct), 1),
                      "detail": f"{outliers:,} numeric value{'s' if outliers != 1 else ''} ({pct:.1f}%) unusually high or low"})

    score = max(0, round(100 - sum(i["penalty"] for i in items)))
    return {"score": score, "breakdown": items}
