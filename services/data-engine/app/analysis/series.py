"""Turn rows into a regular time series of a metric, shared by forecast, anomalies and trend."""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .compute import GRAIN_FREQ, AnalysisError, Context, Metric, _is_datetime, _metric_series, apply_filters, is_partial
from .models import AnalysisSpec

SEASON = {"day": 7, "week": 52, "month": 12, "quarter": 4, "year": 1}
GRAIN_WORD = {"day": "day", "week": "week", "month": "month", "quarter": "quarter", "year": "year"}


@dataclass
class Series:
    values: pd.Series        # indexed by period start (Timestamp), regular, no gaps
    grain: str
    metric: Metric
    kind: str                # money | number
    dropped_partial: str | None
    filled_gaps: int


def default_grain(dates: pd.Series) -> str:
    span = (dates.max() - dates.min()).days
    if span >= 730:
        return "month"
    if span >= 180:
        return "week" if dates.dt.normalize().nunique() > 150 else "month"
    return "day"


def build_series(ctx: Context, spec: AnalysisSpec, *, drop_partial: bool = True) -> Series:
    df = apply_filters(ctx, ctx.df, spec.filters)
    t = ctx.require(spec.time.column)
    if not _is_datetime(t):
        raise AnalysisError("not_a_date", f"\u201c{spec.time.column}\u201d isn't a date column.")
    t = t.loc[df.index]
    m = spec.metrics[0]
    if m.agg not in ("sum", "count", "count_distinct"):
        raise AnalysisError("unsupported_agg", "Forecasts, trends and anomaly checks work on totals and counts, not averages.")
    valid = t.notna()
    df, t = df[valid], t[valid]
    if df.empty:
        raise AnalysisError("no_rows", "No rows match this question's filters.")
    grain = spec.time.grain or default_grain(t)
    freq = GRAIN_FREQ[grain]
    bucket = t.dt.to_period(freq).dt.start_time
    if m.agg == "count" and m.column is None:
        s = bucket.value_counts().sort_index().astype("float64")
    else:
        vals = _metric_series(ctx, df, m)
        s = (vals.groupby(bucket).nunique() if m.agg == "count_distinct" else
             vals.groupby(bucket).count() if m.agg == "count" else vals.groupby(bucket).sum()).astype("float64")
    full = pd.period_range(s.index.min(), s.index.max(), freq=freq).start_time
    filled = int(len(full) - len(s))
    s = s.reindex(full, fill_value=0.0)
    dropped = None
    if drop_partial and len(s) > 1 and is_partial(t, s.index[-1], grain):
        dropped = s.index[-1].isoformat()
        s = s.iloc[:-1]
    if filled:
        ctx.notes.append(f"{filled} {GRAIN_WORD[grain]}{'s' if filled != 1 else ''} with no rows were counted as zero.")
    kind = ctx.kind(m) if m.agg == "sum" else "number"
    return Series(values=s, grain=grain, metric=m, kind=kind, dropped_partial=dropped, filled_gaps=filled)
