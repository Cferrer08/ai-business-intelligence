"""Build the dataset profile: structure, per-column statistics, roles, quality, warnings.

All numbers here are computed from the data. Nothing is estimated by a language model.
"""
from __future__ import annotations

import math
import time
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from .quality import quality_score
from .roles import infer_role
from .types import TypedColumn, infer_types

PREVIEW_ROWS = 20
CORRELATION_SAMPLE = 200_000
CORRELATION_MAX_COLUMNS = 30
STRONG_CORRELATION = 0.7


def _num(x: Any) -> float | int | None:
    """JSON-safe number: NaN/inf become None, numpy scalars become Python numbers."""
    if x is None or x is pd.NA or x is pd.NaT:
        return None
    if isinstance(x, (np.integer,)):
        return int(x)
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return int(f) if f.is_integer() and abs(f) < 2**53 else round(f, 6)


def _json_value(x: Any) -> Any:
    if x is None or x is pd.NA or x is pd.NaT:
        return None
    if isinstance(x, (pd.Timestamp, datetime)):
        return x.isoformat()
    if isinstance(x, (bool, np.bool_)):
        return bool(x)
    if isinstance(x, (int, float, np.integer, np.floating)):
        return _num(x)
    s = str(x)
    return s if len(s) <= 200 else s[:200] + "…"


def _numeric_stats(s: pd.Series) -> dict:
    v = pd.to_numeric(s, errors="coerce").dropna().astype(float)
    v = v[np.isfinite(v)]
    if v.empty:
        return {}
    q = v.quantile([0.05, 0.25, 0.5, 0.75, 0.95])
    q1, q3 = q[0.25], q[0.75]
    iqr = q3 - q1
    lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    outliers = int(((v < lower) | (v > upper)).sum()) if iqr > 0 else 0
    return {
        "mean": _num(v.mean()), "median": _num(q[0.5]), "std": _num(v.std(ddof=1)) if len(v) > 1 else None,
        "min": _num(v.min()), "max": _num(v.max()), "sum": _num(v.sum()),
        "p05": _num(q[0.05]), "q1": _num(q1), "q3": _num(q3), "p95": _num(q[0.95]),
        "zeros": int((v == 0).sum()), "negatives": int((v < 0).sum()),
        "outlier_count": outliers,
        "outlier_bounds": [_num(lower), _num(upper)] if iqr > 0 else None,
    }


def _datetime_stats(s: pd.Series) -> dict:
    v = s.dropna()
    if v.empty:
        return {}
    v = v.sort_values()
    span = (v.iloc[-1] - v.iloc[0]).days
    diffs = v.drop_duplicates().diff().dropna().dt.total_seconds() / 86400
    granularity = None
    if len(diffs) >= 3:
        med = float(diffs.median())
        granularity = ("intraday" if med < 0.9 else "daily" if med < 1.5 else "weekly" if med < 8
                       else "monthly" if med < 32 else "quarterly" if med < 93 else "yearly")
    return {"min": v.iloc[0].isoformat(), "max": v.iloc[-1].isoformat(), "span_days": int(span),
            "distinct_dates": int(v.dt.normalize().nunique()), "granularity": granularity}


def _category_stats(s: pd.Series) -> dict:
    v = s.dropna().astype(str)
    if v.empty:
        return {}
    counts = v.value_counts().head(5)
    return {"top_values": [{"value": k[:120], "count": int(c), "share": _num(c / len(v))} for k, c in counts.items()],
            "avg_length": _num(v.str.len().mean())}


def _column_profile(name: str, position: int, tc: TypedColumn, n_rows: int) -> dict:
    s = tc.series
    missing = int(s.isna().sum())
    non_null = n_rows - missing
    try:
        unique = int(s.nunique(dropna=True))
    except TypeError:
        unique = int(s.astype(str).nunique(dropna=True))
    if tc.logical_type == "numeric":
        stats = _numeric_stats(s)
    elif tc.logical_type == "datetime":
        stats = _datetime_stats(s)
    elif tc.logical_type == "boolean":
        vc = s.dropna().astype(bool)
        stats = {"true_count": int(vc.sum()), "false_count": int((~vc).sum())}
    elif tc.logical_type == "identifier" and pd.api.types.is_numeric_dtype(s):
        stats = {"min": _num(s.min()), "max": _num(s.max())}
    else:
        stats = _category_stats(s)
    role = infer_role(name, tc, n_rows)
    return {
        "name": name, "position": position, "logical_type": tc.logical_type,
        "storage_type": str(s.dtype), "is_integer": tc.is_integer,
        "converted_from": tc.converted_from, "invalid_count": tc.invalid_count,
        "non_null_count": non_null, "missing_count": missing,
        "missing_pct": _num(100 * missing / n_rows) if n_rows else 0,
        "unique_count": unique, "unique_pct": _num(100 * unique / non_null) if non_null else 0,
        "stats": stats,
        "role": {"role": role.role, "concept": role.concept, "confidence": role.confidence,
                 "evidence": role.evidence, "rejected": role.rejected},
    }


def _correlations(df: pd.DataFrame, columns: list[dict]) -> list[dict]:
    names = [c["name"] for c in columns if c["logical_type"] == "numeric" and c["unique_count"] > 1][:CORRELATION_MAX_COLUMNS]
    if len(names) < 2:
        return []
    data = df[names]
    if len(data) > CORRELATION_SAMPLE:
        data = data.sample(CORRELATION_SAMPLE, random_state=0)
    data = data.astype("float64")
    # Spearman (rank) decides what counts as strong: a single extreme value can't hide or
    # fake a relationship. Pearson is reported alongside for linear strength.
    rank = data.corr(method="spearman", min_periods=30)
    linear = data.corr(method="pearson", min_periods=30)
    pairs = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            rho = rank.loc[a, b]
            if pd.notna(rho) and abs(rho) >= STRONG_CORRELATION:
                pairs.append({"a": a, "b": b, "spearman": _num(rho), "pearson": _num(linear.loc[a, b]),
                              "direction": "positive" if rho > 0 else "negative"})
    return sorted(pairs, key=lambda p: -abs(p["spearman"]))[:20]


def _warnings(columns: list[dict], dup: int, n_rows: int) -> list[dict]:
    out = []
    if dup:
        out.append({"level": "warning", "message": f"{dup:,} rows are exact duplicates of another row.", "column": None})
    for c in columns:
        if c["missing_count"] == n_rows:
            continue
        if c["missing_pct"] and c["missing_pct"] > 50:
            out.append({"level": "info", "message": f"{c['missing_pct']:.0f}% of values are empty. Fine for an optional field.", "column": c["name"]})
        elif c["missing_pct"] and c["missing_pct"] >= 20:
            out.append({"level": "warning", "message": f"{c['missing_pct']:.0f}% of values are empty.", "column": c["name"]})
        if c["invalid_count"]:
            out.append({"level": "warning", "column": c["name"],
                        "message": f"{c['invalid_count']:,} values couldn't be read as {'numbers' if c['logical_type'] == 'numeric' else 'dates'} and are treated as empty."})
        if c["unique_count"] == 1 and c["missing_count"] == 0:
            out.append({"level": "info", "message": "Every row has the same value.", "column": c["name"]})
        elif c["unique_count"] == 1:
            out.append({"level": "info", "message": "Only one distinct value; the rest are empty. It may work as a yes/no flag.", "column": c["name"]})
        for r in c["role"]["rejected"]:
            out.append({"level": "info", "message": r, "column": c["name"]})
    roles = {c["role"]["role"] for c in columns}
    if "time" not in roles:
        out.append({"level": "info", "column": None,
                    "message": "No date column was found. Trend and forecast questions need one."})
    if "monetary" not in roles and "quantity" not in roles:
        out.append({"level": "info", "column": None,
                    "message": "No revenue, price or quantity column was recognized. Questions can still use any numeric column by name."})
    return out


def profile_dataframe(raw: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Returns the typed DataFrame (stored as the canonical copy) and the profile."""
    started = time.perf_counter()
    typed_df, typed = infer_types(raw)
    n_rows, n_cols = typed_df.shape
    columns = [_column_profile(name, i, typed[name], n_rows) for i, name in enumerate(typed_df.columns)]
    try:
        duplicates = int(typed_df.duplicated().sum())
    except TypeError:
        duplicates = int(typed_df.astype(str).duplicated().sum())
    missing_cells = int(typed_df.isna().sum().sum())
    quality = quality_score(n_rows=n_rows, n_cols=n_cols, missing_cells=missing_cells,
                            duplicate_rows=duplicates, columns=columns)
    type_counts: dict[str, int] = {}
    for c in columns:
        type_counts[c["logical_type"]] = type_counts.get(c["logical_type"], 0) + 1
    preview = [[_json_value(v) for v in row] for row in typed_df.head(PREVIEW_ROWS).itertuples(index=False, name=None)]
    profile = {
        "row_count": n_rows,
        "column_count": n_cols,
        "type_counts": type_counts,
        "missing_cells": missing_cells,
        "missing_pct": _num(100 * missing_cells / max(1, n_rows * n_cols)),
        "duplicate_rows": duplicates,
        "quality": quality,
        "columns": columns,
        "correlations": _correlations(typed_df, columns),
        "warnings": _warnings(columns, duplicates, n_rows),
        "preview": {"columns": list(typed_df.columns), "rows": preview},
        "profiling_ms": int((time.perf_counter() - started) * 1000),
    }
    return typed_df, profile
