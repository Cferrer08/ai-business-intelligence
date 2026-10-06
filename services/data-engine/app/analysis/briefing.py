"""Business briefings and alert conditions for scheduled workflows.

A briefing compares the latest complete period in the data (day, week or month) with the
one before it: for days, the same weekday a week earlier, so a Monday isn't compared with a
Sunday. Uploaded data isn't a live feed, so the briefing always states the period it covers
and warns when that period is old.
"""
from __future__ import annotations

from datetime import date
from typing import Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from .compute import UNIT_OFFSET, AnalysisError, Context, Facts, _clean, _period_window, fmt, period_label
from .models import AnalysisSpec, ColumnRole, Period

UNIT_WORD = {"day": "day", "week": "week", "month": "month"}
STALE_AFTER = {"day": 3, "week": 14, "month": 45}  # days past the period end before warning


class BriefingRequest(BaseModel):
    unit: Literal["day", "week", "month"]
    columns: list[ColumnRole] = Field(default_factory=list, max_length=500)
    today: date | None = None


class AlertRequest(BaseModel):
    column: str = Field(max_length=120)
    op: Literal["lt", "lte", "gt", "gte", "eq", "neq"]
    value: float | None = None
    value_column: str | None = Field(default=None, max_length=120)   # e.g. stock < reorder_point
    label_columns: list[str] = Field(default_factory=list, max_length=4)
    columns: list[ColumnRole] = Field(default_factory=list, max_length=500)


def run_briefing(df: pd.DataFrame, req: BriefingRequest) -> dict:
    ctx = Context(df, req.columns)
    roles = [c for c in req.columns if c.name in df.columns]
    pick = lambda role, concept=None: next((c.name for c in roles if c.role == role and (concept is None or c.concept == concept)), None)
    time_col = pick("time")
    money = pick("monetary", "revenue") or pick("monetary", "amount") or pick("monetary")
    qty = pick("quantity")
    value_col = money or qty
    order_col, cust_col = pick("identifier", "order"), pick("identifier", "customer")
    if not time_col or not value_col:
        raise AnalysisError("needs_columns", "A briefing needs a date column and a revenue or quantity column.")
    t = df[time_col]
    if not pd.api.types.is_datetime64_any_dtype(t):
        raise AnalysisError("not_a_date", f"\u201c{time_col}\u201d isn't a date column.")
    unit = req.unit
    start, end, _, _ = _period_window(t, Period(kind="latest_complete", unit=unit))
    if unit == "day":
        b_start, b_end = start - pd.Timedelta(days=7), end - pd.Timedelta(days=7)
    else:
        b_start, b_end = start - UNIT_OFFSET[unit], start
    cur, base = df[(t >= start) & (t < end)], df[(t >= b_start) & (t < b_end)]
    cur_label, base_label = period_label(start, end, unit), period_label(b_start, b_end, unit)
    if unit == "day":
        cur_label, base_label = start.strftime("%A, %b %-d, %Y"), b_start.strftime("%A, %b %-d, %Y")
    kind = "money" if money else "number"

    def measures(frame):
        v = float(frame[value_col].astype("float64").sum())
        o = int(frame[order_col].nunique()) if order_col else int(len(frame))
        return {"value": v, "orders": o, "customers": int(frame[cust_col].nunique()) if cust_col else None, "aov": v / o if o and money else None}

    c, b = measures(cur), measures(base)
    pct = lambda x, y: (100 * (x - y) / abs(y)) if (x is not None and y) else None
    facts = Facts()
    facts.add("Period covered", cur_label, "text")
    facts.add("Compared with", base_label, "text")
    label = "Revenue" if money else value_col
    kpis = []
    for key, name, k in [("value", label, kind), ("orders", "Orders" if order_col else "Rows", "number"),
                         ("customers", "Customers", "number"), ("aov", "Average order value", "money")]:
        if c[key] is None:
            continue
        ch = pct(c[key], b[key])
        facts.add(f"{name} in the period", c[key], k)
        if ch is not None:
            facts.add(f"{name} change (absolute percent)", abs(ch), "percent")
            facts.add(f"{name} direction", "up" if ch > 0 else "down" if ch < 0 else "unchanged", "text")
        kpis.append({"key": key, "label": name, "value": _clean(c[key]), "baseline": _clean(b[key]), "format": k, "change_pct": _clean(ch)})

    # Biggest movers: groups whose total changed by 10%+ and that matter (5%+ of the comparison total).
    movers = []
    dims = [c_.name for c_ in roles if c_.role in ("geographic", "category") and 1 < df[c_.name].nunique() <= 50][:2]
    product = next((c_.name for c_ in roles if c_.concept == "product" and c_.name not in dims and 1 < df[c_.name].nunique() <= 200), None)
    for d in dims + ([product] if product else []):
        g = pd.DataFrame({"current": cur.groupby(d, observed=True)[value_col].sum(), "baseline": base.groupby(d, observed=True)[value_col].sum()}).fillna(0)
        total = g["baseline"].sum() or 1
        g["change"] = g["current"] - g["baseline"]
        g["pct"] = np.where(g["baseline"] > 0, 100 * g["change"] / g["baseline"], np.nan)
        g = g[(g["pct"].abs() >= 10) & (g["baseline"] >= 0.05 * total)]
        for name, r in g.reindex(g["change"].abs().sort_values(ascending=False).index).head(3).iterrows():
            movers.append({"dimension": d, "value": str(name), "current": _clean(r["current"]), "baseline": _clean(r["baseline"]),
                           "change": _clean(r["change"]), "change_pct": _clean(r["pct"])})
    movers.sort(key=lambda m: -abs(m["change"] or 0))
    for m in movers[:4]:
        ctx.labels.add(m["value"])
        facts.add(f"{m['dimension']} {m['value']}: direction", "up" if m["change"] > 0 else "down", "text")
        facts.add(f"{m['dimension']} {m['value']}: change (absolute percent)", abs(m["change_pct"]), "percent")

    # Unusual days inside the period (daily data only).
    unusual = []
    try:
        from .advanced import run_anomalies
        spec = AnalysisSpec(type="anomalies", metrics=[{"column": value_col, "agg": "sum", "label": label}],
                            time={"column": time_col, "grain": "day"}, options={"scope": "time"})
        res = run_anomalies(Context(df, req.columns), spec)
        unusual = [f for f in res["flags"] if start <= pd.Timestamp(f["period"]) < end]
    except AnalysisError:
        pass
    facts.add("Unusual days in the period", len(unusual))

    data_through = t.max()
    notes = []
    if req.today is not None:
        days_old = (pd.Timestamp(req.today) - (end - pd.Timedelta(days=1))).days
        if days_old > STALE_AFTER[unit]:
            notes.append(f"The latest data is from {data_through.strftime('%b %-d, %Y')}. Upload newer data for an up-to-date briefing.")
    if unit == "day":
        notes.append("Days are compared with the same weekday a week earlier.")
    return {"type": "briefing", "unit": unit, "period": {"current": cur_label, "baseline": base_label, "start": start.isoformat(), "end": (end - pd.Timedelta(days=1)).isoformat()},
            "kpis": kpis, "movers": movers[:6], "unusual": unusual[:5], "data_through": data_through.isoformat(), "stale": bool(notes and req.today and "Upload newer" in notes[0]),
            "facts": facts.items, "notes": notes, "labels": sorted(ctx.labels)}


def run_alert_rows(df: pd.DataFrame, req: AlertRequest) -> dict:
    """Rows where a numeric column meets a condition, against a fixed value or another column
    (stock below its own reorder point)."""
    ctx = Context(df, req.columns)
    col = ctx.require(req.column)
    if not pd.api.types.is_numeric_dtype(col):
        raise AnalysisError("not_numeric", f"\u201c{req.column}\u201d isn't numeric.")
    if req.value_column:
        other = ctx.require(req.value_column)
        if not pd.api.types.is_numeric_dtype(other):
            raise AnalysisError("not_numeric", f"\u201c{req.value_column}\u201d isn't numeric.")
        rhs, rhs_label = other.astype("float64"), req.value_column
    elif req.value is not None:
        rhs, rhs_label = req.value, fmt(req.value, "number")
    else:
        raise AnalysisError("bad_alert", "The condition needs a value or a column to compare with.")
    lhs = col.astype("float64")
    mask = {"lt": lhs < rhs, "lte": lhs <= rhs, "gt": lhs > rhs, "gte": lhs >= rhs, "eq": lhs == rhs, "neq": lhs != rhs}[req.op]
    hits = df[mask.fillna(False)]
    labels = [c for c in req.label_columns if c in df.columns][:4]
    show = labels + [req.column] + ([req.value_column] if req.value_column else [])
    rows = [{k: _clean(r[k]) if not isinstance(r[k], str) else r[k] for k in show} for _, r in hits.head(50).iterrows()]
    words = {"lt": "below", "lte": "at or below", "gt": "above", "gte": "at or above", "eq": "equal to", "neq": "not equal to"}
    return {"type": "alert_rows", "matches": int(len(hits)), "rows": rows, "condition": f"{req.column} {words[req.op]} {rhs_label}", "columns": show}
