"""Deterministic analysis operations on a dataset's typed copy.

The AI chooses an operation and its parameters; this module does the arithmetic. Results
carry "facts": every number (and every label containing digits, like "September 2026")
the explanation may mention, pre-formatted. The explanation refers to facts by id, so the
language model never writes a number itself.
"""
from __future__ import annotations

import difflib
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..errors import EngineError
from .models import AnalysisSpec, ColumnRole, Filter, Metric, Period  # noqa: F401

MAX_GROUPS_RETURNED = 500
DEFAULT_LIMIT = 25
GRAIN_FREQ = {"day": "D", "week": "W-MON", "month": "M", "quarter": "Q", "year": "Y"}
UNIT_OFFSET = {"day": pd.DateOffset(days=1), "week": pd.DateOffset(weeks=1), "month": pd.DateOffset(months=1),
               "quarter": pd.DateOffset(months=3), "year": pd.DateOffset(years=1)}


class AnalysisError(EngineError):
    status_code = 422


# ---------------------------------------------------------------------------- formatting

def _clean(v: Any) -> Any:
    if v is None or v is pd.NA or v is pd.NaT:
        return None
    if isinstance(v, pd.Timestamp):
        return v.isoformat()
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else round(f, 6)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def fmt(value: float | None, kind: str) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "n/a"
    if kind == "percent":
        return f"{value:.1f}%"
    # Same rule as the web app's tables (lib/format.ts formatMetric), so a value reads the
    # same in the explanation and in the table.
    if abs(value) >= 10_000:
        return f"{value:,.0f}"
    if kind == "money":
        return f"{value:,.2f}"
    if float(value).is_integer():
        return f"{value:,.0f}"
    return f"{value:,.2f}".rstrip("0").rstrip(".")


def period_label(start: pd.Timestamp, end_excl: pd.Timestamp, unit: str | None) -> str:
    last = end_excl - pd.Timedelta(days=1)
    if unit == "month" and start.day == 1:
        return start.strftime("%B %Y")
    if unit == "quarter" and start.day == 1:
        return f"Q{(start.month - 1) // 3 + 1} {start.year}"
    if unit == "year" and start.month == 1 and start.day == 1:
        return str(start.year)
    if start.normalize() == last.normalize():
        return start.strftime("%b %-d, %Y")
    return f"{start.strftime('%b %-d, %Y')} to {last.strftime('%b %-d, %Y')}"


@dataclass
class Facts:
    items: list[dict] = field(default_factory=list)

    def add(self, label: str, value: Any, kind: str = "number") -> str:
        fid = f"f{len(self.items) + 1}"
        if kind == "text":
            self.items.append({"id": fid, "label": label, "kind": "text", "value": str(value), "display": str(value)})
        else:
            v = None if value is None else float(value)
            self.items.append({"id": fid, "label": label, "kind": kind, "value": _clean(v), "display": fmt(v, kind)})
        return fid


# ---------------------------------------------------------------------------- helpers

class Context:
    def __init__(self, df: pd.DataFrame, columns: list[ColumnRole]):
        self.df = df
        self.roles = {c.name: c for c in columns}
        self.notes: list[str] = []
        self.labels: set[str] = set()

    def require(self, name: str) -> pd.Series:
        if name not in self.df.columns:
            close = difflib.get_close_matches(name, list(self.df.columns), n=1)
            hint = f" Did you mean \u201c{close[0]}\u201d?" if close else ""
            raise AnalysisError("unknown_column", f"The dataset has no column \u201c{name}\u201d.{hint}")
        return self.df[name]

    def kind(self, metric: Metric) -> str:
        if metric.agg in ("count", "count_distinct"):
            return "number"
        role = self.roles.get(metric.column or "")
        return "money" if role and role.role == "monetary" else "number"


def _is_datetime(s: pd.Series) -> bool:
    return pd.api.types.is_datetime64_any_dtype(s)


def _is_numeric(s: pd.Series) -> bool:
    return pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s)


def apply_filters(ctx: Context, df: pd.DataFrame, filters: list[Filter]) -> pd.DataFrame:
    for f in filters:
        s = ctx.require(f.column).loc[df.index]
        if _is_datetime(s):
            vals = pd.to_datetime(pd.Series(f.values), errors="coerce")
            if vals.isna().any():
                raise AnalysisError("bad_filter", f"\u201c{f.column}\u201d filter needs dates like 2026-03-31.")
            v = list(vals)
        elif _is_numeric(s):
            vals = pd.to_numeric(pd.Series(f.values), errors="coerce")
            if vals.isna().any():
                raise AnalysisError("bad_filter", f"\u201c{f.column}\u201d filter needs numbers.")
            v = list(vals.astype(float))
            s = s.astype("float64")
        else:
            s = s.astype("string").str.strip()
            v = [str(x).strip() for x in f.values]
            if f.op in ("eq", "neq", "in", "not_in"):
                # Case-insensitive match against the values that actually exist.
                existing = {str(x).lower(): str(x) for x in s.dropna().unique()}
                missing = [x for x in v if x.lower() not in existing]
                if missing and f.op in ("eq", "in") and len(missing) == len(v):
                    close = difflib.get_close_matches(missing[0], list(existing.values()), n=3, cutoff=0.6)
                    hint = f" Closest values: {', '.join(close)}." if close else ""
                    raise AnalysisError("no_match", f"No rows have {f.column} = \u201c{missing[0]}\u201d.{hint}")
                v = [existing.get(x.lower(), x) for x in v]
        op = f.op
        if op in ("eq", "in"):
            mask = s.isin(v)
        elif op in ("neq", "not_in"):
            mask = ~s.isin(v)
        elif op == "contains":
            mask = s.astype("string").str.contains(str(f.values[0]), case=False, regex=False)
        elif op == "between":
            if len(v) != 2:
                raise AnalysisError("bad_filter", "A \u201cbetween\u201d filter needs two values.")
            mask = (s >= v[0]) & (s <= v[1])
        else:
            mask = {"gt": s > v[0], "gte": s >= v[0], "lt": s < v[0], "lte": s <= v[0]}[op]
        df = df[mask.fillna(False).astype(bool)]
        shown = ", ".join(map(str, f.values[:3])) + ("…" if len(f.values) > 3 else "")
        ctx.notes.append(f"Filtered to {f.column} {OP_WORDS[op]} {shown}.")
    return df


OP_WORDS = {"eq": "=", "neq": "≠", "in": "in", "not_in": "not in", "gt": ">", "gte": "≥", "lt": "<", "lte": "≤",
            "between": "between", "contains": "containing"}


def _period_window(dates: pd.Series, period: Period) -> tuple[pd.Timestamp, pd.Timestamp, str | None, bool]:
    """Returns (start, end_exclusive, unit, is_partial). Relative periods are anchored on the
    latest date in the data, not today's date, so "last month" means the data's last month."""
    valid = dates.dropna()
    if valid.empty:
        raise AnalysisError("no_dates", "The date column has no values.")
    lo, hi = valid.min(), valid.max()
    if period.kind == "all":
        return lo.normalize(), hi.normalize() + pd.Timedelta(days=1), None, False
    if period.kind == "absolute":
        start, end = pd.Timestamp(period.start), pd.Timestamp(period.end)
        if pd.isna(start) or pd.isna(end) or end < start:
            raise AnalysisError("bad_period", "The period's dates aren't valid.")
        return start.normalize(), end.normalize() + pd.Timedelta(days=1), None, False
    unit = period.unit
    start = hi.to_period(GRAIN_FREQ[unit]).start_time.normalize()
    end = start + UNIT_OFFSET[unit]
    partial = hi.normalize() + pd.Timedelta(days=1) < end
    if period.kind == "latest_complete" and partial:
        end, start, partial = start, start - UNIT_OFFSET[unit], False
        if end <= lo:
            raise AnalysisError("no_complete_period", f"The data doesn't cover a complete {unit} yet.")
    return start, end, unit, partial


def _metric_series(ctx: Context, df: pd.DataFrame, m: Metric) -> pd.Series | None:
    if m.column is None:
        return None
    s = ctx.require(m.column).loc[df.index]
    if m.agg in ("count", "count_distinct"):
        return s
    if not _is_numeric(s):
        raise AnalysisError("not_numeric", f"\u201c{m.column}\u201d isn't numeric, so it can't be {AGG_WORDS[m.agg]}.")
    return s.astype("float64")


AGG_WORDS = {"sum": "added up", "mean": "averaged", "median": "summarised by median", "min": "used for a minimum",
             "max": "used for a maximum", "count": "counted", "count_distinct": "counted"}


def _aggregate(ctx: Context, df: pd.DataFrame, keys: list, metrics: list[Metric]) -> pd.DataFrame:
    data = pd.DataFrame(index=df.index)
    for k in keys:
        data[k if isinstance(k, str) else k.name] = k if not isinstance(k, str) else df[k]
    names = [k if isinstance(k, str) else k.name for k in keys]
    out = {}
    for m in metrics:
        s = _metric_series(ctx, df, m)
        if m.agg == "count" and s is None:
            series = pd.Series(1, index=df.index)
            func = "sum"
        else:
            series, func = s, {"count": "count", "count_distinct": "nunique"}.get(m.agg, m.agg)
        data["__v"] = series
        if names:
            out[m.label] = data.groupby(names, dropna=True, observed=True)["__v"].agg(func)
        else:
            out[m.label] = pd.Series([data["__v"].agg(func)], index=[0])
    return pd.DataFrame(out)


def _add_ratio(table: pd.DataFrame, spec: AnalysisSpec) -> None:
    r = spec.ratio
    if not r:
        return
    num, den = table[spec.metrics[r.numerator].label], table[spec.metrics[r.denominator].label]
    val = num / den.replace(0, np.nan)
    table[r.label] = val * 100 if r.as_percent else val


# ---------------------------------------------------------------------------- operations

def run_aggregate(ctx: Context, spec: AnalysisSpec) -> dict:
    df = apply_filters(ctx, ctx.df, spec.filters)
    keys: list = []
    time_key = None
    if spec.time:
        t = ctx.require(spec.time.column)
        if not _is_datetime(t):
            raise AnalysisError("not_a_date", f"\u201c{spec.time.column}\u201d isn't a date column.")
        if spec.period and spec.period.kind != "all":
            start, end, unit, partial = _period_window(t.loc[df.index], spec.period)
            df = df[(t.loc[df.index] >= start) & (t.loc[df.index] < end)]
            ctx.notes.append(f"Period: {period_label(start, end, unit)}{' (partial, the data ends mid-period)' if partial else ''}.")
        if spec.time.grain:
            bucket = t.loc[df.index].dt.to_period(GRAIN_FREQ[spec.time.grain]).dt.start_time
            bucket.name = spec.time.column
            keys.append(bucket)
            time_key = spec.time.column
    for d in spec.dimensions:
        ctx.require(d)
        keys.append(d)
    if df.empty:
        raise AnalysisError("no_rows", "No rows match this question's filters and period.")

    table = _aggregate(ctx, df, keys, spec.metrics)
    _add_ratio(table, spec)
    table = table.reset_index()
    if not keys:
        table = table.drop(columns=["index"], errors="ignore")
    total_groups = len(table)

    value_cols = [m.label for m in spec.metrics] + ([spec.ratio.label] if spec.ratio else [])
    if time_key and not spec.dimensions:
        table = table.sort_values(time_key)  # time series stay in time order
    else:
        by = spec.sort.by if spec.sort and spec.sort.by in table.columns else value_cols[0]
        table = table.sort_values(by, ascending=bool(spec.sort and spec.sort.direction == "asc"), na_position="last")
    limit = min(spec.limit or (MAX_GROUPS_RETURNED if time_key and not spec.dimensions else DEFAULT_LIMIT), MAX_GROUPS_RETURNED)
    if total_groups > limit:
        ctx.notes.append(f"Showing {limit} of {total_groups:,} groups.")
        table = table.head(limit)

    facts = Facts()
    kinds = {m.label: ctx.kind(m) for m in spec.metrics}
    if spec.ratio:
        kinds[spec.ratio.label] = "percent" if spec.ratio.as_percent else "number"
    facts.add("Rows analysed", len(df))
    for m in spec.metrics:
        if m.agg in ("sum", "count") and keys:
            facts.add(f"Total {m.label}", table[m.label].sum() if total_groups <= limit else _aggregate(ctx, df, [], [m]).iloc[0, 0], kinds[m.label])

    def row_name(row) -> str:
        parts = []
        if time_key:
            parts.append(_bucket_label(row[time_key], spec.time.grain))
        parts += [str(row[d]) for d in spec.dimensions]
        return " / ".join(parts) or "All rows"

    for _, row in table.head(10).iterrows():
        name = row_name(row)
        ctx.labels.add(name)
        for d in spec.dimensions:
            ctx.labels.add(str(row[d]))
        if time_key:
            facts.add("Period", _bucket_label(row[time_key], spec.time.grain), "text")
        for col in value_cols:
            facts.add(f"{name}: {col}", row[col], kinds[col])

    if time_key and not spec.dimensions and len(table) >= 2:
        first, last = table.iloc[0], table.iloc[-1]
        v0, v1 = first[value_cols[0]], last[value_cols[0]]
        facts.add("First period", _bucket_label(first[time_key], spec.time.grain), "text")
        facts.add("Last period", _bucket_label(last[time_key], spec.time.grain), "text")
        if pd.notna(v0) and v0:
            facts.add(f"Change in {value_cols[0]} from first to last period", 100 * (v1 - v0) / abs(v0), "percent")
        hi = table.loc[table[value_cols[0]].idxmax()]
        lo = table.loc[table[value_cols[0]].idxmin()]
        facts.add(f"Highest {value_cols[0]} period", _bucket_label(hi[time_key], spec.time.grain), "text")
        facts.add(f"Highest {value_cols[0]}", hi[value_cols[0]], kinds[value_cols[0]])
        facts.add(f"Lowest {value_cols[0]} period", _bucket_label(lo[time_key], spec.time.grain), "text")
        facts.add(f"Lowest {value_cols[0]}", lo[value_cols[0]], kinds[value_cols[0]])

    columns = []
    if time_key:
        columns.append({"key": time_key, "label": spec.time.column, "kind": "time", "format": "date", "grain": spec.time.grain})
    columns += [{"key": d, "label": d, "kind": "dimension", "format": "text"} for d in spec.dimensions]
    columns += [{"key": c, "label": c, "kind": "metric", "format": kinds[c]} for c in value_cols]
    chart = None
    if time_key and not spec.dimensions:
        chart = {"kind": "line", "x": time_key, "y": value_cols[:2]}
    elif spec.dimensions:
        chart = {"kind": "bar", "x": spec.dimensions[0], "y": value_cols[:1]}
    return {"table": {"columns": columns, "rows": _rows(table, [c["key"] for c in columns])},
            "facts": facts.items, "rows_considered": int(len(df)), "groups_total": int(total_groups), "chart": chart}


def _bucket_label(ts: Any, grain: str | None) -> str:
    ts = pd.Timestamp(ts)
    return {"day": ts.strftime("%b %-d, %Y"), "week": f"Week of {ts.strftime('%b %-d, %Y')}", "month": ts.strftime("%B %Y"),
            "quarter": f"Q{(ts.month - 1) // 3 + 1} {ts.year}", "year": str(ts.year)}.get(grain or "", ts.strftime("%b %-d, %Y"))


def _rows(table: pd.DataFrame, keys: list[str]) -> list[dict]:
    return [{k: _clean(r[k]) for k in keys} for _, r in table.iterrows()]


def run_compare(ctx: Context, spec: AnalysisSpec) -> dict:
    df = apply_filters(ctx, ctx.df, spec.filters)
    t = ctx.require(spec.time.column)
    if not _is_datetime(t):
        raise AnalysisError("not_a_date", f"\u201c{spec.time.column}\u201d isn't a date column.")
    t = t.loc[df.index]
    start, end, unit, partial = _period_window(t, spec.period)
    if spec.comparison == "same_period_last_year":
        b_start, b_end = start - pd.DateOffset(years=1), end - pd.DateOffset(years=1)
    elif unit:
        b_start, b_end = start - UNIT_OFFSET[unit], start
    else:
        b_start, b_end = start - (end - start), start
    cur, base = df[(t >= start) & (t < end)], df[(t >= b_start) & (t < b_end)]
    if cur.empty:
        raise AnalysisError("no_rows", "No rows fall in the period being analysed.")
    if base.empty:
        raise AnalysisError("no_baseline", f"There's no data for the comparison period ({period_label(b_start, b_end, unit)}).")
    cur_label, base_label = period_label(start, end, unit), period_label(b_start, b_end, unit)
    if partial:
        ctx.notes.append(f"{cur_label} is incomplete in the data, so it is compared with only part of a period's activity.")

    m = spec.metrics[0]
    kind = ctx.kind(m)
    c_total = _aggregate(ctx, cur, [], [m]).iloc[0, 0]
    b_total = _aggregate(ctx, base, [], [m]).iloc[0, 0]
    change = c_total - b_total
    pct = 100 * change / abs(b_total) if b_total else None

    facts = Facts()
    facts.add("Current period", cur_label, "text")
    facts.add("Comparison period", base_label, "text")
    facts.add(f"{m.label} in current period", c_total, kind)
    facts.add(f"{m.label} in comparison period", b_total, kind)
    facts.add("Direction", "increased" if change > 0 else "decreased" if change < 0 else "did not change", "text")
    facts.add(f"Change in {m.label} (absolute amount)", abs(change), kind)
    if pct is not None:
        facts.add(f"Change in {m.label} (absolute percent)", abs(pct), "percent")
    other = []
    for extra in spec.metrics[1:]:
        ec = _aggregate(ctx, cur, [], [extra]).iloc[0, 0]
        eb = _aggregate(ctx, base, [], [extra]).iloc[0, 0]
        ek = ctx.kind(extra)
        facts.add(f"{extra.label} in current period", ec, ek)
        facts.add(f"{extra.label} in comparison period", eb, ek)
        if eb:
            facts.add(f"Change in {extra.label} (percent, signed)", 100 * (ec - eb) / abs(eb), "percent")
        other.append({"label": extra.label, "current": _clean(ec), "baseline": _clean(eb), "format": ek})

    contributors = []
    for d in spec.dimensions:
        ctx.require(d)
        c = _aggregate(ctx, cur, [d], [m])[m.label]
        b = _aggregate(ctx, base, [d], [m])[m.label]
        g = pd.DataFrame({"current": c, "baseline": b}).fillna(0)
        g["change"] = g["current"] - g["baseline"]
        g["change_pct"] = np.where(g["baseline"] != 0, 100 * g["change"] / g["baseline"].abs(), np.nan)
        g["share_of_change"] = 100 * g["change"] / change if change else np.nan
        # Rank groups that moved in the same direction as the total first.
        g = g.sort_values("change", ascending=change < 0)
        rows = []
        for value, r in g.head(8).iterrows():
            label = str(value)
            ctx.labels.add(label)
            rows.append({"value": label, **{k: _clean(r[k]) for k in ("current", "baseline", "change", "change_pct", "share_of_change")}})
        for value, r in g.head(3).iterrows():
            facts.add(f"{d} {value}: change in {m.label} (absolute amount)", abs(r["change"]), kind)
            facts.add(f"{d} {value}: direction", "increased" if r["change"] > 0 else "decreased" if r["change"] < 0 else "unchanged", "text")
            if pd.notna(r["change_pct"]):
                facts.add(f"{d} {value}: change (absolute percent)", abs(r["change_pct"]), "percent")
            if pd.notna(r["share_of_change"]):
                facts.add(f"{d} {value}: share of the total change", r["share_of_change"], "percent")
        if change:
            top2 = g.head(2)["change"].sum()
            facts.add(f"Share of the total change from the top two {d} values", 100 * top2 / change, "percent")
        if change and (g["share_of_change"].abs() > 100).any():
            ctx.notes.append(f"Some {d} values moved in the opposite direction to the total, so individual shares of the change can exceed 100%.")
        contributors.append({"dimension": d, "rows": rows, "groups_total": int(len(g))})

    return {
        "period": {"current": {"start": start.isoformat(), "end": (end - pd.Timedelta(days=1)).isoformat(), "label": cur_label, "partial": bool(partial)},
                   "baseline": {"start": b_start.isoformat(), "end": (b_end - pd.Timedelta(days=1)).isoformat(), "label": base_label}},
        "summary": {"metric": m.label, "format": kind, "current": _clean(c_total), "baseline": _clean(b_total),
                    "change": _clean(change), "change_pct": _clean(pct), "other_metrics": other},
        "contributors": contributors,
        "facts": facts.items,
        "rows_considered": int(len(cur) + len(base)),
        "chart": {"kind": "bar", "x": spec.dimensions[0], "y": ["change"]} if spec.dimensions else None,
    }


def run_overview(ctx: Context, spec: AnalysisSpec) -> dict:
    df = apply_filters(ctx, ctx.df, spec.filters)
    facts = Facts()
    facts.add("Rows", len(df))
    by_role: dict[str, list[ColumnRole]] = {}
    for c in ctx.roles.values():
        if c.name in df.columns:
            by_role.setdefault(c.role, []).append(c)
    time_col = (by_role.get("time") or [None])[0]
    money = by_role.get("monetary", [])
    qty = by_role.get("quantity", [])
    primary = (next((c for c in money if c.concept == "revenue"), None) or (money[0] if money else None)
               or (qty[0] if qty else None))
    summary_rows = []
    for c in (money + qty)[:6]:
        total = df[c.name].astype("float64").sum()
        kind = "money" if c.role == "monetary" else "number"
        facts.add(f"Total {c.name}", total, kind)
        summary_rows.append({"metric": f"Total {c.name}", "value": _clean(total), "format": kind})
    for c in by_role.get("identifier", [])[:3]:
        if c.concept in ("customer", "order", "product"):
            n = df[c.name].nunique()
            facts.add(f"Distinct {c.name}", n)
            summary_rows.append({"metric": f"Distinct {c.name}", "value": int(n), "format": "number"})
    if time_col:
        t = df[time_col.name].dropna()
        if not t.empty:
            facts.add("Data starts", t.min().strftime("%b %-d, %Y"), "text")
            facts.add("Data ends", t.max().strftime("%b %-d, %Y"), "text")
    trend = None
    if time_col and primary:
        try:
            m = Metric(column=primary.name, agg="sum", label=primary.name)
            sub = AnalysisSpec(type="compare_periods", metrics=[m], time={"column": time_col.name},
                               period={"kind": "latest_complete", "unit": "month"}, comparison="previous_period")
            inner = Context(df, list(ctx.roles.values()))
            res = run_compare(inner, sub)
            trend = res["summary"] | {"period": res["period"]}
            facts.add("Latest complete month", res["period"]["current"]["label"], "text")
            facts.add("Month before", res["period"]["baseline"]["label"], "text")
            facts.add(f"{primary.name} in latest complete month", res["summary"]["current"], ctx.kind(m))
            if res["summary"]["change_pct"] is not None:
                facts.add(f"{primary.name} change vs month before (percent, signed)", res["summary"]["change_pct"], "percent")
        except AnalysisError:
            pass
    leaders = []
    if primary:
        dims = (by_role.get("geographic", []) + by_role.get("category", []))[:3]
        for d in dims:
            g = df.groupby(d.name, observed=True)[primary.name].sum().sort_values(ascending=False)
            if g.empty:
                continue
            total = g.sum()
            top_name, top_val = str(g.index[0]), g.iloc[0]
            ctx.labels.add(top_name)
            facts.add(f"Top {d.name} by {primary.name}", top_name, "text")
            facts.add(f"{top_name}: {primary.name}", top_val, "money" if primary.role == "monetary" else "number")
            if total:
                facts.add(f"{top_name}: share of total {primary.name}", 100 * top_val / total, "percent")
            leaders.append({"dimension": d.name, "value": top_name, "amount": _clean(top_val), "share": _clean(100 * top_val / total if total else None)})
    if not money and not qty:
        ctx.notes.append("No revenue, price or quantity column was recognised, so totals are limited.")
    return {"summary_rows": summary_rows, "trend": trend, "leaders": leaders, "facts": facts.items,
            "rows_considered": int(len(df)), "chart": None}


def run_distribution(ctx: Context, spec: AnalysisSpec) -> dict:
    """How values of one numeric column are spread: histogram bins plus summary facts."""
    df = apply_filters(ctx, ctx.df, spec.filters)
    m = spec.metrics[0]
    if spec.time and spec.period and spec.period.kind != "all":
        t = ctx.require(spec.time.column).loc[df.index]
        start, end, unit, partial = _period_window(t, spec.period)
        df = df[(t >= start) & (t < end)]
        ctx.notes.append(f"Period: {period_label(start, end, unit)}.")
    v = _metric_series(ctx, df, Metric(column=m.column, agg="sum", label=m.label)).dropna()
    v = v[np.isfinite(v)]
    if v.empty:
        raise AnalysisError("no_rows", "There are no values to show for this column.")
    kind = ctx.kind(Metric(column=m.column, agg="sum", label=m.label))
    is_int = bool((v % 1 == 0).all())
    uniq = np.sort(v.unique())
    if is_int and len(uniq) <= 30:
        counts = v.value_counts().reindex(uniq, fill_value=0)
        bins = [{"start": _clean(x), "end": _clean(x), "label": fmt(x, kind), "count": int(c)} for x, c in counts.items()]
    else:
        edges = np.histogram_bin_edges(v, bins="auto")
        n = int(min(30, max(8, len(edges) - 1)))
        counts, edges = np.histogram(v, bins=n)
        bins = [{"start": _clean(edges[i]), "end": _clean(edges[i + 1]),
                 "label": f"{fmt(edges[i], kind)} to {fmt(edges[i + 1], kind)}", "count": int(counts[i])} for i in range(len(counts))]
    total = len(v)
    for b in bins:
        b["share"] = _clean(100 * b["count"] / total)
    q1, med, q3 = v.quantile([0.25, 0.5, 0.75])
    iqr = q3 - q1
    outliers = int(((v < q1 - 1.5 * iqr) | (v > q3 + 1.5 * iqr)).sum()) if iqr > 0 else 0
    facts = Facts()
    facts.add(f"Values of {m.label}", total)
    facts.add(f"Median {m.label}", med, kind)
    facts.add(f"Average {m.label}", v.mean(), kind)
    facts.add(f"Middle half of {m.label} from", q1, kind)
    facts.add(f"Middle half of {m.label} to", q3, kind)
    facts.add(f"Lowest {m.label}", v.min(), kind)
    facts.add(f"Highest {m.label}", v.max(), kind)
    top = max(bins, key=lambda b: b["count"])
    facts.add("Most common range", top["label"], "text")
    facts.add("Share in the most common range", top["share"], "percent")
    facts.add("Unusually high or low values", outliers)
    if v.mean() > med * 1.25 and med > 0:
        ctx.notes.append(f"The average is well above the median, so a few large values pull it up; the median is the more typical value.")
    return {"bins": bins, "summary": {"metric": m.label, "format": kind}, "facts": facts.items, "rows_considered": int(total),
            "chart": {"kind": "histogram", "x": "label", "y": ["count"]}}


def run_dashboard(df: pd.DataFrame, columns: list[ColumnRole]) -> dict:
    """KPIs for the dashboard: latest complete month vs the month before, plus a monthly
    series and the groups that moved most. Picks columns by their verified roles."""
    ctx = Context(df, columns)
    roles = [c for c in columns if c.name in df.columns]
    pick = lambda role, concept=None: next((c.name for c in roles if c.role == role and (concept is None or c.concept == concept)), None)
    time_col = pick("time")
    money = pick("monetary", "revenue") or pick("monetary", "amount") or pick("monetary")
    qty = pick("quantity")
    order_col = pick("identifier", "order")
    cust_col = pick("identifier", "customer")
    value_col = money or qty
    value_kind = "money" if money else "number"
    out: dict = {"columns": {"time": time_col, "value": value_col, "orders": order_col, "customers": cust_col},
                 "kpis": [], "series": [], "movers": [], "period": None, "notes": []}
    if not value_col:
        out["notes"].append("No revenue, amount or quantity column was recognised in this dataset.")
        return out

    def measures(frame: pd.DataFrame) -> dict:
        value = float(frame[value_col].astype("float64").sum())
        orders = int(frame[order_col].nunique()) if order_col else int(len(frame))
        customers = int(frame[cust_col].nunique()) if cust_col else None
        return {"value": value, "orders": orders, "customers": customers, "aov": value / orders if orders and money else None}

    cur = base = None
    if time_col and pd.api.types.is_datetime64_any_dtype(df[time_col]):
        t = df[time_col]
        try:
            start, end, unit, _ = _period_window(t, Period(kind="latest_complete", unit="month"))
            b_start = start - UNIT_OFFSET["month"]
            cur, base = measures(df[(t >= start) & (t < end)]), measures(df[(t >= b_start) & (t < start)])
            out["period"] = {"current": period_label(start, end, "month"), "baseline": period_label(b_start, start, "month")}
            monthly = df.groupby(t.dt.to_period("M").dt.start_time, observed=True)
            series = monthly[value_col].sum()
            orders_s = monthly[order_col].nunique() if order_col else monthly.size()
            # Months after the latest complete one are partial; flag them so a chart doesn't
            # show an incomplete month as a drop.
            out["series"] = [{"month": k.isoformat(), "value": _clean(v), "orders": int(orders_s.loc[k]), "partial": bool(k >= end)}
                             for k, v in series.items()]
            dims = [c.name for c in roles if c.role in ("geographic", "category") and 1 < df[c.name].nunique() <= 50][:2]
            cur_df, base_df = df[(t >= start) & (t < end)], df[(t >= b_start) & (t < start)]
            for d in dims:
                g = pd.DataFrame({"current": cur_df.groupby(d, observed=True)[value_col].sum(),
                                  "baseline": base_df.groupby(d, observed=True)[value_col].sum()}).fillna(0)
                g["change"] = g["current"] - g["baseline"]
                g["change_pct"] = np.where(g["baseline"] != 0, 100 * g["change"] / g["baseline"].abs(), np.nan)
                g = g.reindex(g["change"].abs().sort_values(ascending=False).index).head(3)
                out["movers"].append({"dimension": d, "rows": [{"value": str(k), **{c: _clean(r[c]) for c in g.columns}} for k, r in g.iterrows()]})
        except AnalysisError:
            out["notes"].append("The data doesn't cover a complete month yet, so month-over-month changes aren't shown.")
    if cur is None:
        cur = measures(df)

    def pct(a, b):
        return _clean(100 * (a - b) / abs(b)) if base is not None and a is not None and b else None

    label = value_col if not money else ("Revenue" if pick("monetary", "revenue") else value_col)
    out["kpis"] = [
        {"key": "value", "label": label, "value": _clean(cur["value"]), "format": value_kind, "change_pct": pct(cur["value"], base and base["value"])},
        {"key": "orders", "label": "Orders" if order_col else "Rows", "value": cur["orders"], "format": "number", "change_pct": pct(cur["orders"], base and base["orders"])},
    ]
    if cust_col:
        out["kpis"].append({"key": "customers", "label": "Customers", "value": cur["customers"], "format": "number", "change_pct": pct(cur["customers"], base and base["customers"])})
    if cur["aov"] is not None:
        out["kpis"].append({"key": "aov", "label": "Average order value", "value": _clean(cur["aov"]), "format": "money", "change_pct": pct(cur["aov"], base and base["aov"])})
    if not order_col:
        out["notes"].append("No order id column was recognised, so orders are counted as rows.")
    return out


def analyze(df: pd.DataFrame, spec: AnalysisSpec, columns: list[ColumnRole]) -> dict:
    ctx = Context(df, columns)
    runner = {"aggregate": run_aggregate, "compare_periods": run_compare, "overview": run_overview, "distribution": run_distribution}[spec.type]
    result = runner(ctx, spec)
    result["type"] = spec.type
    result["notes"] = ctx.notes
    result["labels"] = sorted(ctx.labels)[:500]
    return result
