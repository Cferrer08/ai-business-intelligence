"""Anomaly detection, correlation, customer segmentation and trend analysis.

Each method is chosen to be explainable: every flagged value or segment comes with the
numbers that put it there.
"""
from __future__ import annotations

import math
import warnings

import numpy as np
import pandas as pd

from .compute import AnalysisError, Context, Facts, Metric, _bucket_label, _clean, _is_datetime, _is_numeric, apply_filters, fmt
from .models import AnalysisSpec
from .series import SEASON, build_series

THRESHOLD = {"low": 4.0, "normal": 3.5, "high": 3.0}   # robust z-score cut-offs
# A flag must also be big enough to matter: a statistically unusual 4% wobble isn't news.
MIN_DEVIATION_PCT = {4.0: 20.0, 3.5: 10.0, 3.0: 5.0}
MAX_FLAGS = 50


def _robust_z(x: np.ndarray, center: np.ndarray | float, scale: float) -> np.ndarray:
    return (x - center) / scale if scale > 0 else np.zeros_like(x)


def _mad_scale(x: np.ndarray) -> float:
    x = x[np.isfinite(x)]
    if len(x) == 0:
        return 0.0
    mad = float(np.median(np.abs(x - np.median(x))))
    if mad == 0:
        mad = float(np.mean(np.abs(x - np.mean(x)))) * 0.8  # fallback when most values are identical
    return 1.4826 * mad


# ---------------------------------------------------------------------------- anomalies

def _time_anomalies(ctx: Context, spec: AnalysisSpec, thr: float) -> dict:
    s = build_series(ctx, spec, drop_partial=True)
    y = s.values.to_numpy(dtype=float)
    n = len(y)
    if n < 10:
        raise AnalysisError("too_little_history", f"Checking for unusual {s.grain}s needs at least 10 of them; this data has {n}.")
    # Expected value for each period from its neighbours, never from itself, so an outlier
    # can't pull its own baseline toward it. Daily data uses the same weekday in the four
    # weeks before and after (weekends compared with weekends); other units use the two
    # periods on each side.
    if s.grain == "day" and n >= 28:
        offsets, method = [7 * k for k in (1, 2, 3, 4)], "same weekday in the surrounding four weeks"
    else:
        offsets, method = [1, 2], "surrounding periods"
    shifted = [s.values.shift(o) for o in offsets] + [s.values.shift(-o) for o in offsets]
    expected = pd.concat(shifted, axis=1).median(axis=1, skipna=True).to_numpy()
    resid = y - expected
    scale = _mad_scale(resid[np.isfinite(resid)])
    z = _robust_z(resid, 0.0, scale)
    with np.errstate(divide="ignore", invalid="ignore"):
        dev_pct = np.where(expected != 0, 100 * np.abs(resid) / np.abs(expected), np.inf)
    unusual = (np.abs(z) >= thr) & (dev_pct >= MIN_DEVIATION_PCT[thr])
    idx = np.where(unusual)[0]
    idx = idx[np.argsort(-np.abs(z[idx]))][:MAX_FLAGS]
    kind = s.kind
    flags = []
    for i in sorted(idx):
        p = s.values.index[i]
        dev = 100 * resid[i] / abs(expected[i]) if expected[i] else None
        label = _bucket_label(p, s.grain)
        ctx.labels.add(label)
        flags.append({"period": p.isoformat(), "label": label, "value": _clean(y[i]), "expected": _clean(expected[i]),
                      "deviation_pct": _clean(dev), "score": _clean(abs(z[i])), "direction": "above" if resid[i] > 0 else "below",
                      "reason": f"{s.metric.label} was {fmt(y[i], kind)} against an expected {fmt(expected[i], kind)}"
                                + (f" ({abs(dev):.0f}% {'above' if resid[i] > 0 else 'below'})" if dev is not None else "")
                                + f", {abs(z[i]):.1f} times the usual variation."})
    facts = Facts()
    facts.add(f"{s.grain.capitalize()}s checked", n)
    facts.add(f"Unusual {s.grain}s found", len(flags))
    facts.add("Method", f"Compared with the {method}", "text")
    for f in sorted(flags, key=lambda f: -f["score"])[:3]:
        facts.add(f"{f['label']}: {s.metric.label}", f["value"], kind)
        facts.add(f"{f['label']}: expected {s.metric.label}", f["expected"], kind)
        facts.add(f"{f['label']}: direction", f["direction"], "text")
        if f["deviation_pct"] is not None:
            facts.add(f"{f['label']}: difference from expected (absolute percent)", abs(f["deviation_pct"]), "percent")
    series = [{"period": k.isoformat(), "label": _bucket_label(k, s.grain), "value": _clean(v), "expected": _clean(e),
               "flagged": bool(u)} for k, v, e, u in zip(s.values.index, y, expected, unusual)]
    return {"scope": "time", "grain": s.grain, "method": method, "threshold": thr, "series": series, "flags": flags,
            "summary": {"metric": s.metric.label, "format": kind}, "facts": facts.items, "rows_considered": int(len(ctx.df)),
            "chart": {"kind": "anomaly_line"}}


def _record_anomalies(ctx: Context, spec: AnalysisSpec, thr: float) -> dict:
    df = apply_filters(ctx, ctx.df, spec.filters)
    cols = [m.column for m in spec.metrics if m.column] or [
        c.name for c in ctx.roles.values() if c.role in ("monetary", "quantity", "metric") and c.name in df.columns]
    cols = [c for c in cols if _is_numeric(ctx.require(c))][:8]
    if not cols:
        raise AnalysisError("no_numeric", "Unusual-transaction checks need at least one numeric column.")
    data = df[cols].astype("float64")
    zs = pd.DataFrame(index=data.index)
    for c in cols:
        v = data[c].to_numpy()
        zs[c] = _robust_z(v, np.nanmedian(v), _mad_scale(v))
    extreme = zs.abs().max(axis=1) >= thr
    method = "robust z-scores"
    iso = pd.Series(False, index=data.index)
    complete = data.dropna()
    if len(cols) >= 2 and len(complete) >= 200:
        from sklearn.ensemble import IsolationForest
        feats = complete.copy()
        for c in cols:
            # log-scale skewed positive values so one huge order doesn't dominate the model
            if (feats[c] >= 0).all() and feats[c].skew() > 1:
                feats[c] = np.log1p(feats[c])
        feats = (feats - feats.mean()) / feats.std(ddof=0).replace(0, 1)
        model = IsolationForest(n_estimators=200, contamination=0.01, random_state=0).fit(feats)
        iso.loc[complete.index] = model.predict(feats) == -1
        method = "robust z-scores and an isolation forest for unusual combinations"
    flagged = data.index[extreme | iso]
    ids = [c.name for c in ctx.roles.values() if c.role == "identifier" and c.name in df.columns][:2]
    medians = data.median()
    rows = []
    for i in flagged:
        z = zs.loc[i]
        parts = []
        for c in z.abs().sort_values(ascending=False).index:
            if abs(z[c]) >= 2.5 and pd.notna(data.at[i, c]):
                ratio = data.at[i, c] / medians[c] if medians[c] else None
                parts.append(f"{c} is {fmt(data.at[i, c], 'number')} (typical {fmt(medians[c], 'number')}" + (f", {ratio:.1f}×" if ratio and ratio > 1 else "") + ")")
        reason = "; ".join(parts[:2]) if parts else "Unusual combination of values: " + ", ".join(f"{c} {fmt(data.at[i, c], 'number')}" for c in cols[:3])
        rows.append({"row": int(i) + 2, **{k: _clean(df.at[i, k]) if not isinstance(df.at[i, k], str) else df.at[i, k] for k in ids},
                     **{c: _clean(data.at[i, c]) for c in cols}, "score": _clean(float(z.abs().max())), "reason": reason})
    rows.sort(key=lambda r: -(r["score"] or 0))
    rows = rows[:MAX_FLAGS]
    facts = Facts()
    facts.add("Rows checked", len(df))
    facts.add("Unusual rows found", int(len(flagged)))
    facts.add("Share of rows flagged", 100 * len(flagged) / max(1, len(df)), "percent")
    facts.add("Columns checked", ", ".join(cols), "text")
    for c in cols[:2]:
        facts.add(f"Typical {c}", medians[c], "money" if ctx.roles.get(c) and ctx.roles[c].role == "monetary" else "number")
    if len(flagged) > MAX_FLAGS:
        ctx.notes.append(f"Showing the {MAX_FLAGS} most unusual of {len(flagged):,} flagged rows.")
    ctx.notes.append("Row numbers match the uploaded file, counting the header as row 1.")
    return {"scope": "records", "method": method, "threshold": thr, "columns": cols, "id_columns": ids, "flags": rows,
            "summary": {"metric": cols[0], "format": "number"}, "facts": facts.items, "rows_considered": int(len(df)), "chart": None}


def _group_anomalies(ctx: Context, spec: AnalysisSpec, thr: float) -> dict:
    if not spec.dimensions:
        raise AnalysisError("needs_dimension", "Choose a grouping, such as region or product, to check for unusual changes.")
    d = spec.dimensions[0]
    ctx.require(d)
    base = build_series(ctx, spec, drop_partial=True)   # validates columns, picks grain, drops partial
    grain = base.grain
    last = base.values.index[-1]
    df = apply_filters(ctx, ctx.df, spec.filters)
    t = df[spec.time.column]
    from .compute import GRAIN_FREQ
    bucket = t.dt.to_period(GRAIN_FREQ[grain]).dt.start_time
    m = spec.metrics[0]
    vals = (pd.Series(1.0, index=df.index) if m.column is None else df[m.column].astype("float64"))
    table = vals.groupby([df[d], bucket], observed=True).sum().unstack(fill_value=0.0)
    table = table.reindex(columns=base.values.index, fill_value=0.0)
    if table.shape[1] < 5:
        raise AnalysisError("too_little_history", f"Checking groups needs at least 5 complete {grain}s of history.")
    # Judge each group against how the TYPICAL group moved this period: the median across
    # groups of (this period / that group's usual level). Seasons and growth that move every
    # group cancel out, and one collapsing group can't drag a median, so the others aren't
    # flagged just because their share rose. Noise is measured from the groups' past
    # differences from that common movement. Needs 3+ groups; with fewer, each group is
    # compared with its own history.
    totals = table.sum(axis=0)
    usual = table.iloc[:, :-1].median(axis=1)
    relative = len(table) >= 3 and (usual > 0).sum() >= 3
    if relative:
        ratio = table.div(usual.replace(0, np.nan), axis=0)
        common = ratio.median(axis=0, skipna=True)
        resid = ratio.div(common.replace(0, np.nan), axis=1) - 1
        past = resid.iloc[:, :-1].to_numpy().ravel()
        scale = max(_mad_scale(past[np.isfinite(past)]), 0.05)
    rows = []
    for g, r in table.iterrows():
        cur = float(r.iloc[-1])
        if relative and usual[g] > 0:
            expected = float(usual[g] * common.iloc[-1])
            z = float(resid.loc[g].iloc[-1]) / scale
        else:
            hist = r.iloc[:-1].to_numpy()
            expected = float(np.median(hist))
            sc = _mad_scale(hist) or abs(expected) * 0.1
            z = (cur - expected) / sc if sc else 0.0
        pct = 100 * (cur - expected) / abs(expected) if expected else None
        share_info = {}
        if totals.iloc[-1] > 0 and (totals.iloc[:-1] > 0).all():
            share_info = {"share": _clean(100 * cur / totals.iloc[-1]), "typical_share": _clean(100 * float(np.median(r.iloc[:-1] / totals.iloc[:-1])))}
        rows.append({"value": str(g), "current": _clean(cur), "typical": _clean(expected), "deviation_pct": _clean(pct), "score": _clean(abs(z)),
                     "flagged": bool(abs(z) >= thr and (pct is None or abs(pct) >= max(15.0, MIN_DEVIATION_PCT[thr]))),
                     "direction": "above" if cur > expected else "below", **share_info})
    rows.sort(key=lambda r: -(r["score"] or 0))
    flags = [r for r in rows if r["flagged"]]
    label = _bucket_label(last, grain)
    kind = base.kind
    facts = Facts()
    facts.add("Period checked", label, "text")
    facts.add(f"{d} values checked", len(rows))
    facts.add(f"{d} values with an unusual {grain}", len(flags))
    for r in flags[:3]:
        ctx.labels.add(r["value"])
        facts.add(f"{r['value']}: {m.label} in {label}", r["current"], kind)
        facts.add(f"{r['value']}: expected {m.label}", r["typical"], kind)
        facts.add(f"{r['value']}: direction", r["direction"], "text")
        if r["deviation_pct"] is not None:
            facts.add(f"{r['value']}: difference from typical (absolute percent)", abs(r["deviation_pct"]), "percent")
    for r in rows:
        r["reason"] = (f"{m.label} in {label} was {fmt(r['current'], kind)} against an expected {fmt(r['typical'], kind)}"
                       + (f" ({abs(r['deviation_pct']):.0f}% {r['direction']})" if r["deviation_pct"] is not None else "")
                       + (f"; its share of the total was {r['share']:.0f}% against a usual {r['typical_share']:.0f}%" if "share" in r else "") + ".")
    if relative:
        ctx.notes.append(f"Each {d} is compared with how the typical {d} moved in {label}, so seasonal ups and downs that affect every {d} aren't flagged.")
    return {"scope": "groups", "grain": grain, "period": label, "dimension": d, "threshold": thr, "groups": rows[:MAX_FLAGS], "flags": flags,
            "summary": {"metric": m.label, "format": kind}, "facts": facts.items, "rows_considered": int(len(df)),
            "chart": {"kind": "diverging"}}


def run_anomalies(ctx: Context, spec: AnalysisSpec) -> dict:
    opts = spec.options
    thr = THRESHOLD[(opts.sensitivity if opts and opts.sensitivity else "normal")]
    scope = opts.scope if opts and opts.scope else ("time" if spec.time and spec.metrics else "records")
    if scope == "time":
        if not (spec.time and spec.metrics):
            raise AnalysisError("needs_time", "Checking for unusual days or months needs a date column and a metric.")
        return _time_anomalies(ctx, spec, thr)
    if scope == "groups":
        if not (spec.time and spec.metrics):
            raise AnalysisError("needs_time", "Checking groups for unusual changes needs a date column and a metric.")
        return _group_anomalies(ctx, spec, thr)
    return _record_anomalies(ctx, spec, thr)


# ---------------------------------------------------------------------------- correlation

def _holm(pvals: list[float]) -> list[float]:
    order = np.argsort(pvals)
    adj = np.empty(len(pvals))
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(pvals) - rank) * pvals[i]))
        adj[i] = running
    return adj.tolist()


def _strength(r: float) -> str:
    a = abs(r)
    return "very strong" if a >= 0.8 else "strong" if a >= 0.6 else "moderate" if a >= 0.4 else "weak" if a >= 0.2 else "negligible"


def run_correlation(ctx: Context, spec: AnalysisSpec) -> dict:
    from scipy import stats
    df = apply_filters(ctx, ctx.df, spec.filters)
    cols = [m.column for m in spec.metrics if m.column] or [
        c.name for c in ctx.roles.values() if c.role in ("monetary", "quantity", "metric") and c.name in df.columns]
    cols = [c for c in dict.fromkeys(cols) if _is_numeric(ctx.require(c)) and df[c].nunique() > 2][:12]
    if len(cols) < 2:
        raise AnalysisError("needs_two_numeric", "Correlation needs at least two numeric columns.")
    level = "rows"
    data = df[cols].astype("float64")
    if spec.time and spec.time.grain:
        from .compute import GRAIN_FREQ
        t = ctx.require(spec.time.column).loc[df.index]
        data = data.groupby(t.dt.to_period(GRAIN_FREQ[spec.time.grain]).dt.start_time).sum()
        level = f"{spec.time.grain}ly totals"
    pairs = []
    for i, a in enumerate(cols):
        for b in cols[i + 1:]:
            sub = data[[a, b]].dropna()
            if len(sub) < 10:
                continue
            rho, p = stats.spearmanr(sub[a], sub[b])
            r, _ = stats.pearsonr(sub[a], sub[b])
            if np.isnan(rho):
                continue
            pairs.append({"a": a, "b": b, "spearman": float(rho), "pearson": float(r), "p": float(p), "n": int(len(sub))})
    if not pairs:
        raise AnalysisError("too_few_rows", "There aren't enough rows with values in both columns to measure a relationship.")
    for pr, adj in zip(pairs, _holm([p["p"] for p in pairs])):
        pr["p_adjusted"] = adj
        pr["significant"] = adj < 0.05
        pr["strength"] = _strength(pr["spearman"])
    pairs.sort(key=lambda p: -abs(p["spearman"]))
    matrix = {a: {b: None for b in cols} for a in cols}
    for p in pairs:
        matrix[p["a"]][p["b"]] = matrix[p["b"]][p["a"]] = _clean(p["spearman"])
    for c in cols:
        matrix[c][c] = 1.0
    top = pairs[0]
    sample = data[[top["a"], top["b"]]].dropna()
    if len(sample) > 1500:
        sample = sample.sample(1500, random_state=0)
    facts = Facts()
    facts.add("Columns compared", len(cols))
    facts.add("Level", level, "text")
    for p in pairs[:3]:
        facts.add(f"{p['a']} and {p['b']}: strength", p["strength"], "text")
        facts.add(f"{p['a']} and {p['b']}: direction", "rise together" if p["spearman"] > 0 else "move in opposite directions", "text")
        facts.add(f"{p['a']} and {p['b']}: statistically clear", "yes" if p["significant"] else "no, could be chance", "text")
    ctx.notes.append("Correlation shows that two measures move together, not that one causes the other.")
    ctx.notes.append("p-values are adjusted for testing many pairs at once (Holm method).")
    return {"columns": cols, "level": level,
            "pairs": [{k: (_clean(v) if isinstance(v, float) else v) for k, v in p.items()} for p in pairs],
            "matrix": matrix, "scatter": {"x": top["a"], "y": top["b"], "points": [{"x": _clean(x), "y": _clean(y)} for x, y in sample.itertuples(index=False)]},
            "summary": {"metric": top["a"], "format": "number"}, "facts": facts.items, "rows_considered": int(len(df)),
            "chart": {"kind": "matrix"}}


# ---------------------------------------------------------------------------- segmentation (RFM)

SEGMENTS = [
    ("Champions", "Bought recently, buy often and spend the most.", lambda r, f, m: r >= 4 and f >= 4),
    ("Loyal", "Buy regularly; not their most recent purchase window.", lambda r, f, m: r >= 3 and f >= 4),
    ("Potential loyalists", "Recent customers with a few purchases.", lambda r, f, m: r >= 4 and f >= 2),
    ("New", "First purchase was recent.", lambda r, f, m: r >= 4),
    ("Need attention", "Middling recency and frequency.", lambda r, f, m: r == 3),
    ("At risk", "Used to buy often but haven't recently.", lambda r, f, m: r <= 2 and f >= 3),
    ("Hibernating", "Infrequent and not recent.", lambda r, f, m: True),
]


def _score(s: pd.Series, reverse: bool = False) -> pd.Series:
    pct = s.rank(method="average", pct=True)
    if reverse:
        pct = 1 - pct + 1 / len(s)
    return np.ceil(pct * 5).clip(1, 5).astype(int)


def run_segmentation(ctx: Context, spec: AnalysisSpec) -> dict:
    df = apply_filters(ctx, ctx.df, spec.filters)
    pick = lambda role, concept=None: next((c.name for c in ctx.roles.values() if c.role == role and (concept is None or c.concept == concept) and c.name in df.columns), None)
    cust = spec.dimensions[0] if spec.dimensions else pick("identifier", "customer")
    time_col = spec.time.column if spec.time else pick("time")
    money = (spec.metrics[0].column if spec.metrics and spec.metrics[0].column else None) or pick("monetary", "revenue") or pick("monetary")
    order = pick("identifier", "order")
    if not (cust and time_col and money):
        raise AnalysisError("needs_rfm_columns", "Customer segments need a customer id, a date and a revenue column.")
    for c in (cust, time_col, money):
        ctx.require(c)
    if not _is_datetime(df[time_col]):
        raise AnalysisError("not_a_date", f"\u201c{time_col}\u201d isn't a date column.")
    d = df[[cust, time_col, money] + ([order] if order else [])].dropna(subset=[cust, time_col])
    as_of = d[time_col].max() + pd.Timedelta(days=1)
    g = d.groupby(cust, observed=True)
    rfm = pd.DataFrame({
        "recency_days": (as_of - g[time_col].max()).dt.days,
        "frequency": g[order].nunique() if order else g.size(),
        "monetary": g[money].sum().astype("float64"),
    })
    if len(rfm) < 20:
        raise AnalysisError("too_few_customers", f"Segmentation needs at least 20 customers; this data has {len(rfm)}.")
    rfm["R"] = _score(rfm["recency_days"], reverse=True)
    rfm["F"] = _score(rfm["frequency"])
    rfm["M"] = _score(rfm["monetary"])
    def seg(row):
        for name, _, rule in SEGMENTS:
            if rule(row.R, row.F, row.M):
                return name
    rfm["segment"] = rfm.apply(seg, axis=1)
    total_rev = rfm["monetary"].sum()
    segs = []
    for name, desc, _ in SEGMENTS:
        part = rfm[rfm.segment == name]
        if part.empty:
            continue
        top = part.sort_values("monetary", ascending=False).head(5)
        segs.append({"segment": name, "description": desc, "customers": int(len(part)), "share_customers": _clean(100 * len(part) / len(rfm)),
                     "revenue": _clean(part.monetary.sum()), "share_revenue": _clean(100 * part.monetary.sum() / total_rev if total_rev else 0),
                     "avg_recency_days": _clean(part.recency_days.mean()), "avg_frequency": _clean(part.frequency.mean()),
                     "avg_monetary": _clean(part.monetary.mean()), "top_customers": [str(x) for x in top.index]})
        ctx.labels.add(name)
    facts = Facts()
    facts.add("Customers segmented", len(rfm))
    facts.add("Measured up to", (as_of - pd.Timedelta(days=1)).strftime("%b %-d, %Y"), "text")
    for s in sorted(segs, key=lambda s: -s["share_revenue"])[:4]:
        facts.add(f"{s['segment']}: customers", s["customers"])
        facts.add(f"{s['segment']}: share of revenue", s["share_revenue"], "percent")
    risk = next((s for s in segs if s["segment"] == "At risk"), None)
    if risk:
        facts.add("At risk: revenue from these customers so far", risk["revenue"], "money")
    ctx.notes.append("Segments use recency, frequency and spend scored 1 to 5 relative to your other customers (RFM).")
    if not order:
        ctx.notes.append("No order id column was recognised, so frequency counts rows per customer.")
    return {"segments": segs, "columns": {"customer": cust, "time": time_col, "money": money, "order": order},
            "summary": {"metric": money, "format": "money"}, "facts": facts.items, "rows_considered": int(len(d)),
            "chart": {"kind": "bar"}}


# ---------------------------------------------------------------------------- trend

def run_trend(ctx: Context, spec: AnalysisSpec) -> dict:
    from scipy import stats
    s = build_series(ctx, spec)
    y = s.values.to_numpy(dtype=float)
    n = len(y)
    if n < 6:
        raise AnalysisError("too_little_history", f"A trend needs at least 6 complete {s.grain}s; this data has {n}.")
    x = np.arange(n)
    # Mann-Kendall test for "is there a trend" and its matching Theil-Sen slope for "how
    # steep": both rank-based, so one extreme period can't flip the direction.
    tau, p_tau = stats.kendalltau(x, y)
    slope, intercept, _, _ = stats.theilslopes(y, x)
    fitted = intercept + slope * x
    mean = float(np.median(y)) or 1.0
    clear = p_tau < 0.05 and slope != 0
    direction = ("rising" if slope > 0 else "falling") if clear else "no clear trend"
    kind = s.kind
    facts = Facts()
    facts.add("Periods analysed", f"{n} {s.grain}s", "text")
    facts.add("From", _bucket_label(s.values.index[0], s.grain), "text")
    facts.add("To", _bucket_label(s.values.index[-1], s.grain), "text")
    facts.add("Trend", direction, "text")
    facts.add(f"Typical change per {s.grain} (absolute amount)", abs(slope), kind)
    facts.add(f"Typical change per {s.grain} as a share of the typical level (absolute percent)", abs(100 * slope / mean), "percent")
    facts.add("Statistically clear", "yes" if clear else "no, the ups and downs could be chance", "text")
    facts.add(f"Typical {s.metric.label} per {s.grain}", mean, kind)
    if s.dropped_partial:
        ctx.notes.append(f"The last {s.grain} in the data is incomplete and was left out.")
    ctx.notes.append("The trend line uses the median slope between all pairs of periods (Theil-Sen), so a single extreme period can't swing it. A clear trend means the direction is unlikely to be chance (Mann-Kendall test, p < 0.05).")
    series = [{"period": k.isoformat(), "label": _bucket_label(k, s.grain), "value": _clean(v), "trend": _clean(f)} for k, v, f in zip(s.values.index, y, fitted)]
    return {"series": series, "grain": s.grain, "slope": _clean(slope), "kendall_tau": _clean(tau), "p_value": _clean(p_tau),
            "direction": direction, "summary": {"metric": s.metric.label, "format": kind}, "facts": facts.items,
            "rows_considered": int(len(ctx.df)), "chart": {"kind": "line"}}
