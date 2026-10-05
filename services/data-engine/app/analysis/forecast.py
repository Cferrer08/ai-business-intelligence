"""Forecasting with model selection by backtest.

Candidates go from simplest to richest. Each is scored on rolling-origin backtests (fit on
the past, predict the next periods, compare with what actually happened). A richer model is
chosen only if it beats the best simpler one by more than 5% (10% for trend and seasonal
models) on the backtest windows both could run, so complexity has to earn its place. Prediction ranges come from the chosen model's own backtest errors at each step
ahead, so they reflect how wrong it actually was on this data.
"""
from __future__ import annotations

import math
import warnings

import numpy as np
import pandas as pd

from .compute import AnalysisError, Context, Facts, _bucket_label, _clean
from .models import AnalysisSpec
from .series import SEASON, build_series

MIN_PERIODS = 8
DEFAULT_HORIZON = {"day": 14, "week": 8, "month": 3, "quarter": 2, "year": 1}
MAX_HORIZON = {"day": 90, "week": 52, "month": 24, "quarter": 8, "year": 3}
IMPROVEMENT_REQUIRED = {"moving_average": 0.05, "seasonal_naive": 0.05, "ses": 0.05, "holt": 0.10, "holt_linear": 0.10,
                        "holt_winters": 0.10, "holt_winters_linear": 0.10}
MAX_FOLDS = 5

DESCRIPTIONS = {
    "naive": "Last value carried forward",
    "seasonal_naive": "Same period last cycle",
    "moving_average": "Average of recent periods",
    "ses": "Exponential smoothing (level only)",
    "holt": "Exponential smoothing with a damped trend",
    "holt_linear": "Exponential smoothing with a steady trend",
    "holt_winters": "Exponential smoothing with damped trend and seasonality",
    "holt_winters_linear": "Exponential smoothing with steady trend and seasonality",
}
COMPLEXITY = ["naive", "seasonal_naive", "moving_average", "ses", "holt", "holt_linear", "holt_winters", "holt_winters_linear"]


def _components(name: str) -> tuple[str | None, bool, str | None]:
    """(trend, damped, seasonal) for each exponential smoothing variant."""
    return {"ses": (None, False, None), "holt": ("add", True, None), "holt_linear": ("add", False, None),
            "holt_winters": ("add", True, "add"), "holt_winters_linear": ("add", False, "add")}[name]


def _model_sd(name: str, y: np.ndarray, h: int, m: int) -> np.ndarray:
    """The model's own forecast standard deviation per step ahead.
    Exponential smoothing: from the ETS state-space model's prediction intervals.
    Naive-style methods: one-step error spread growing with the square root of distance."""
    if name in ("ses", "holt", "holt_linear", "holt_winters", "holt_winters_linear"):
        from statsmodels.tsa.exponential_smoothing.ets import ETSModel
        trend, damped, seasonal = _components(name)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            kw = {"error": "add", "trend": trend, "damped_trend": damped, "seasonal": seasonal}
            if seasonal:
                kw["seasonal_periods"] = m
            res = ETSModel(y, **kw).fit(disp=False)
            frame = res.get_prediction(start=len(y), end=len(y) + h - 1).summary_frame(alpha=0.05)
        return np.asarray((frame["pi_upper"] - frame["mean"]) / 1.96, dtype=float)
    lag = m if name == "seasonal_naive" and len(y) > m else 1
    diffs = y[lag:] - y[:-lag]
    one_step = float(np.sqrt(np.mean(np.square(diffs)))) if len(diffs) > 1 else float(np.std(y))  # includes drift
    if name == "moving_average":
        one_step = np.std(y - pd.Series(y).rolling(3, min_periods=1).mean().shift(1).bfill().to_numpy(), ddof=1)
    steps = np.arange(1, h + 1)
    return one_step * (np.sqrt(np.ceil(steps / lag)) if lag > 1 else np.sqrt(steps))


def _fit_predict(name: str, y: np.ndarray, h: int, m: int) -> np.ndarray:
    if name == "naive":
        return np.repeat(y[-1], h)
    if name == "seasonal_naive":
        last = y[-m:]
        return np.array([last[i % m] for i in range(h)])
    if name == "moving_average":
        w = min(len(y), max(3, m if m <= 12 else 4))
        return np.repeat(y[-w:].mean(), h)
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        trend, damped, seasonal = _components(name)
        model = ExponentialSmoothing(y, trend=trend, damped_trend=damped, seasonal=seasonal,
                                     seasonal_periods=m if seasonal else None, initialization_method="estimated")
        return np.asarray(model.fit(optimized=True).forecast(h), dtype=float)


def _candidates(n: int, m: int) -> list[str]:
    out = ["naive", "moving_average", "ses"]
    if n >= 10:
        out += ["holt", "holt_linear"]
    if m > 1 and n >= 2 * m + 2:
        out[1:1] = ["seasonal_naive"]
        out += ["holt_winters", "holt_winters_linear"]
    return out


MIN_TRAIN = {"naive": 1, "moving_average": 3, "ses": 4, "holt": 8, "holt_linear": 8}


def _backtest(name: str, y: np.ndarray, h: int, m: int, folds: int) -> dict[int, np.ndarray]:
    """Errors (actual - forecast) per backtest window. Windows a model can't fit (too little
    training data for it) are skipped rather than disqualifying the model."""
    need = MIN_TRAIN.get(name, 2 * m + 2)
    errs: dict[int, np.ndarray] = {}
    step = max(1, h // 2)
    for k in range(folds - 1, -1, -1):   # oldest origin first
        end = len(y) - h - k * step
        train, test = y[:end], y[end:end + h]
        if len(train) < need or len(test) < h:
            continue
        try:
            pred = _fit_predict(name, train, h, m)
        except Exception:
            continue
        if np.all(np.isfinite(pred)):
            errs[k] = test - pred
    return errs


def _mae(errs: dict[int, np.ndarray], folds: set[int]) -> float:
    return float(np.mean(np.abs(np.concatenate([errs[f] for f in folds]))))


def run_forecast(ctx: Context, spec: AnalysisSpec) -> dict:
    s = build_series(ctx, spec)
    y = s.values.to_numpy(dtype=float)
    n = len(y)
    grain = s.grain
    if n < MIN_PERIODS:
        raise AnalysisError("too_little_history", f"A forecast needs at least {MIN_PERIODS} complete {grain}s of history; this data has {n}. Try a smaller time unit such as weeks or days.")
    h = (spec.options.horizon if spec.options and spec.options.horizon else DEFAULT_HORIZON[grain])
    h = min(h, MAX_HORIZON[grain])
    if h > n // 2:
        ctx.notes.append(f"Forecasting {h} {grain}s ahead from {n} of history is a long reach; treat later periods with extra caution.")
    m = SEASON[grain]
    bt_h = max(1, min(h, n // 4))
    folds = max(1, min(MAX_FOLDS, (n - MIN_PERIODS) // max(1, bt_h // 2) - 1))

    runs = {name: e for name in _candidates(n, m) if (e := _backtest(name, y, bt_h, m, folds))}
    if "naive" not in runs:
        raise AnalysisError("forecast_failed", "There isn't enough history to test a forecast reliably.")
    # Simplest model wins unless a richer one is clearly more accurate on the same windows.
    best = "naive"
    for name in sorted(runs, key=COMPLEXITY.index):
        if name == "naive":
            continue
        shared = set(runs[name]) & set(runs[best])
        if shared and _mae(runs[name], shared) < _mae(runs[best], shared) * (1 - IMPROVEMENT_REQUIRED[name]):
            best = name
    best_errs = np.array([runs[best][f] for f in sorted(runs[best])])
    best_mae = float(np.mean(np.abs(best_errs)))
    naive_mae = _mae(runs["naive"], set(runs[best]))
    scores = {k: (_mae(v, set(v)), None) for k, v in runs.items()}

    pred = _fit_predict(best, y, h, m)
    nonneg = bool((y >= 0).all())
    # Ranges from backtest errors. Root-mean-square error per step ahead counts both spread
    # and bias (a model that keeps running low is less certain than its spread suggests).
    # Steps beyond the backtest grow with the square root of distance; few backtest samples
    # widen the range using the t distribution.
    from scipy import stats
    rmse_step = np.sqrt(np.mean(np.square(best_errs), axis=0))
    overall = float(np.sqrt(np.mean(np.square(best_errs)))) or float(np.std(y)) * 0.1 or 1.0
    k = len(rmse_step)
    sds = np.array([max(rmse_step[i], 0.5 * overall) if i < k else rmse_step[-1] * math.sqrt((i + 1) / k) for i in range(h)])
    sds = np.maximum.accumulate(sds)  # uncertainty never shrinks further out
    samples = best_errs.size
    sds = sds * (stats.t.ppf(0.975, max(1, samples - 1)) / 1.96 if samples < 30 else 1.0)
    # Take the wider of the backtest-based and model-based uncertainty for each period.
    try:
        model_sd = _model_sd(best, y, h, m)
        if np.all(np.isfinite(model_sd)):
            sds = np.maximum(sds, model_sd)
    except Exception:
        pass
    # Seasonal patterns estimated from few cycles are themselves uncertain (each month's
    # pattern may rest on two or three observations), which neither estimate above captures.
    if best in ("seasonal_naive", "holt_winters", "holt_winters_linear"):
        sds = sds * math.sqrt(1 + 2 * m / n)
    periods = pd.date_range(start=s.values.index[-1], periods=h + 1, freq={"day": "D", "week": "7D", "month": "MS", "quarter": "QS", "year": "YS"}[grain])[1:]
    clip = (lambda v: max(0.0, v)) if nonneg else (lambda v: v)
    forecast = [{"period": p.isoformat(), "value": _clean(clip(v)), "lo80": _clean(clip(v - 1.2816 * sd)), "hi80": _clean(v + 1.2816 * sd),
                 "lo95": _clean(clip(v - 1.96 * sd)), "hi95": _clean(v + 1.96 * sd)} for p, v, sd in zip(periods, pred, sds)]
    history = [{"period": k.isoformat(), "value": _clean(v)} for k, v in s.values.items()]

    # Seasonality strength (how much the cycle explains), for the explanation only.
    seasonal = None
    if m > 1 and n >= 2 * m + 2:
        try:
            from statsmodels.tsa.seasonal import STL
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                r = STL(s.values, period=m, robust=True).fit()
            var_r = np.var(r.resid)
            seasonal = float(max(0.0, 1 - var_r / max(1e-12, np.var(r.resid + r.seasonal))))
        except Exception:
            seasonal = None

    kind = s.kind
    improvement = 100 * (1 - best_mae / naive_mae) if naive_mae > 0 else 0.0
    mean_level = float(np.mean(np.abs(y[-max(3, bt_h):]))) or 1.0
    facts = Facts()
    facts.add("Method", DESCRIPTIONS[best], "text")
    facts.add("History used", f"{n} {grain}s", "text")
    facts.add("First forecast period", _bucket_label(periods[0], grain), "text")
    facts.add(f"Forecast {s.metric.label} for the first period", forecast[0]["value"], kind)
    facts.add("Likely range for the first period, low (80%)", forecast[0]["lo80"], kind)
    facts.add("Likely range for the first period, high (80%)", forecast[0]["hi80"], kind)
    facts.add("Last forecast period", _bucket_label(periods[-1], grain), "text")
    facts.add(f"Forecast {s.metric.label} for the last period", forecast[-1]["value"], kind)
    facts.add(f"Total forecast {s.metric.label} over the forecast", sum(f["value"] for f in forecast), kind)
    facts.add(f"Last actual {s.metric.label}", y[-1], kind)
    facts.add("Last actual period", _bucket_label(s.values.index[-1], grain), "text")
    facts.add("Typical backtest error", best_mae, kind)
    facts.add("Typical backtest error as a share of recent values", 100 * best_mae / mean_level, "percent")
    facts.add("Improvement over carrying the last value forward", improvement, "percent")
    if seasonal is not None:
        facts.add("Share of variation explained by the yearly or weekly cycle", 100 * seasonal, "percent")

    ctx.notes.append("Forecasts assume past patterns continue; they can't anticipate new promotions, price changes or one-off events.")
    if s.dropped_partial:
        ctx.notes.append(f"The last {grain} in the data is incomplete and was left out of the history.")
    if m > 1 and n < 2 * m + 2 and grain in ("month", "week"):
        cycle = "year" if grain in ("month", "week") else "week"
        ctx.notes.append(f"Seasonal patterns need at least two full {cycle}s of history to estimate; this data has {n} {grain}s, so the forecast doesn't include seasonality.")
    if best == "naive":
        ctx.notes.append("No method beat simply repeating the last value in backtests, so that is the forecast. The data may be too noisy or short for a pattern.")
    return {
        "history": history, "forecast": forecast, "grain": grain,
        "model": {"name": best, "description": DESCRIPTIONS[best]},
        "backtest": {"mae": _clean(best_mae), "naive_mae": _clean(naive_mae), "improvement_pct": _clean(improvement),
                     "folds": int(best_errs.shape[0]), "steps": int(bt_h),
                     "candidates": [{"name": k, "description": DESCRIPTIONS[k], "mae": _clean(v[0])} for k, v in sorted(scores.items(), key=lambda kv: kv[1][0])]},
        "seasonality_strength": _clean(seasonal),
        "summary": {"metric": s.metric.label, "format": kind},
        "facts": facts.items, "rows_considered": int(len(ctx.df)),
        "chart": {"kind": "forecast"},
    }
