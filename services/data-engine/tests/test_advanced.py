"""Advanced analytics on data with planted, known answers."""
import numpy as np
import pandas as pd
import pytest

from app.analysis.compute import AnalysisError, analyze
from app.analysis.models import AnalysisSpec, ColumnRole

ROLES = [
    ColumnRole(name="date", logical_type="datetime", role="time", concept="date"),
    ColumnRole(name="order_id", logical_type="identifier", role="identifier", concept="order"),
    ColumnRole(name="customer_id", logical_type="identifier", role="identifier", concept="customer"),
    ColumnRole(name="region", logical_type="categorical", role="geographic", concept="region"),
    ColumnRole(name="units", logical_type="numeric", role="quantity", concept="quantity"),
    ColumnRole(name="revenue", logical_type="numeric", role="monetary", concept="revenue"),
]
REV = [{"column": "revenue", "agg": "sum", "label": "Revenue"}]


def spec(**kw):
    return AnalysisSpec.model_validate(kw)


def fact(res, part):
    return next(f for f in res["facts"] if part in f["label"])


@pytest.fixture
def daily():
    """180 days with a weekday pattern (weekends slow), one planted spike and one planted drop."""
    rng = np.random.default_rng(3)
    days = pd.date_range("2026-01-05", periods=182, freq="D")  # Monday start, ends Sunday
    rows = []
    for i, d in enumerate(days):
        level = 1000 * (0.4 if d.dayofweek >= 5 else 1.0)
        if d == pd.Timestamp("2026-03-11"):
            level *= 3.5
        if d == pd.Timestamp("2026-05-13"):
            level *= 0.15
        for k in range(10):
            rows.append({"date": d, "order_id": f"O{i}-{k}", "customer_id": f"C{rng.integers(0, 120)}",
                         "region": ["NE", "S", "W"][k % 3], "units": int(rng.integers(1, 5)),
                         "revenue": level / 10 * rng.uniform(0.9, 1.1)})
    return pd.DataFrame(rows)


def test_time_anomalies_find_the_planted_days_only(daily):
    res = analyze(daily, spec(type="anomalies", metrics=REV, time={"column": "date", "grain": "day"}, options={"scope": "time"}), ROLES)
    found = {f["period"][:10] for f in res["flags"]}
    assert found == {"2026-03-11", "2026-05-13"}
    spike = next(f for f in res["flags"] if f["period"].startswith("2026-03-11"))
    assert spike["direction"] == "above" and spike["deviation_pct"] > 150
    assert "expected" in spike["reason"]
    assert res["method"] == "same weekday in the surrounding four weeks"  # weekends weren't flagged


def test_sensitivity_changes_threshold(daily):
    low = analyze(daily, spec(type="anomalies", metrics=REV, time={"column": "date", "grain": "day"}, options={"scope": "time", "sensitivity": "low"}), ROLES)
    high = analyze(daily, spec(type="anomalies", metrics=REV, time={"column": "date", "grain": "day"}, options={"scope": "time", "sensitivity": "high"}), ROLES)
    assert len(low["flags"]) <= len(high["flags"])


def test_record_anomalies_explain_each_row(daily):
    df = daily.copy()
    df.loc[100, ["units", "revenue"]] = [2, 25000.0]            # huge order
    df.loc[200, ["units", "revenue"]] = [40, 90.0]               # many units, tiny revenue
    res = analyze(df, spec(type="anomalies", metrics=[], options={"scope": "records"}), ROLES)
    rows = {r["row"]: r for r in res["flags"]}
    assert 102 in rows and 202 in rows                           # file row = index + 2
    assert "revenue" in rows[102]["reason"] and "typical" in rows[102]["reason"]
    assert rows[102]["order_id"] == df.loc[100, "order_id"]
    assert fact(res, "Rows checked")["value"] == len(df)


def test_group_anomalies_flag_the_collapsing_region():
    rows = []
    for m in pd.date_range("2025-01-01", "2026-08-01", freq="MS"):
        for r in ["NE", "S", "W", "MW"]:
            v = 1000 + (hash(r) % 50)
            if r == "NE" and m == pd.Timestamp("2026-08-01"):
                v = 300
            rows.append({"date": m + pd.Timedelta(days=3), "region": r, "revenue": float(v)})
    rows.append({"date": pd.Timestamp("2026-09-02"), "region": "NE", "revenue": 10.0})  # partial month, ignored
    df = pd.DataFrame(rows)
    res = analyze(df, spec(type="anomalies", metrics=REV, dimensions=["region"], time={"column": "date", "grain": "month"}, options={"scope": "groups"}), ROLES)
    assert [g["value"] for g in res["flags"]] == ["NE"]
    assert res["period"] == "August 2026"
    assert res["flags"][0]["deviation_pct"] == pytest.approx(-70, abs=3)


def test_correlation_separates_real_from_chance():
    rng = np.random.default_rng(5)
    x = rng.normal(100, 20, 300)
    df = pd.DataFrame({"spend": x, "revenue": 3 * x + rng.normal(0, 15, 300), "noise": rng.normal(0, 1, 300)})
    roles = [ColumnRole(name=c, logical_type="numeric", role="metric") for c in df.columns]
    res = analyze(df, spec(type="correlation", metrics=[]), roles)
    top = res["pairs"][0]
    assert {top["a"], top["b"]} == {"spend", "revenue"} and top["significant"] and top["strength"] == "very strong"
    others = [p for p in res["pairs"] if "noise" in (p["a"], p["b"])]
    assert all(not p["significant"] for p in others)
    assert all(p["p_adjusted"] >= p["p"] for p in res["pairs"])
    assert res["matrix"]["spend"]["revenue"] == res["matrix"]["revenue"]["spend"]
    assert any("not that one causes" in n for n in res["notes"])


def test_rfm_segments_known_customers():
    end = pd.Timestamp("2026-09-30")
    rows = []
    def add(cust, n, days_ago_latest, amount):
        for k in range(n):
            rows.append({"customer_id": cust, "order_id": f"{cust}-{k}", "date": end - pd.Timedelta(days=days_ago_latest + 20 * k), "revenue": amount})
    # A realistic spread: most customers sit in the middle, with clear groups at the edges.
    for i in range(10): add(f"champ{i}", 12, 1 + i, 300.0)        # recent, frequent, big
    for i in range(10): add(f"new{i}", 1, 2 + i, 60.0)            # one recent order
    for i in range(30): add(f"mid{i}", 4, 40 + 3 * i, 90.0)       # regular, middling
    for i in range(10): add(f"risk{i}", 10, 240 + i, 250.0)       # used to buy often, not lately
    for i in range(10): add(f"sleep{i}", 1, 300 + i, 20.0)        # one old small order
    df = pd.DataFrame(rows)
    res = analyze(df, spec(type="segmentation", metrics=[]), ROLES)
    seg_of = {}
    for s in res["segments"]:
        for c in s["top_customers"]:
            seg_of[c] = s["segment"]
    assert seg_of["champ0"] == "Champions"
    assert seg_of["risk0"] == "At risk"
    assert seg_of["new0"] == "New"
    assert seg_of["sleep0"] == "Hibernating"
    assert sum(s["customers"] for s in res["segments"]) == 70
    assert sum(s["share_revenue"] for s in res["segments"]) == pytest.approx(100)


def test_trend_detects_rise_and_ignores_noise():
    rng = np.random.default_rng(9)
    months = pd.date_range("2025-01-01", periods=20, freq="MS")
    rising = pd.DataFrame({"date": months + pd.Timedelta(days=1), "revenue": [1000 + 40 * i + rng.normal(0, 30) for i in range(20)]})
    res = analyze(rising, spec(type="trend", metrics=REV, time={"column": "date", "grain": "month"}), ROLES)
    assert res["direction"] == "rising" and res["slope"] == pytest.approx(40, abs=8)
    noisy = pd.DataFrame({"date": months + pd.Timedelta(days=1), "revenue": rng.normal(1000, 100, 20)})
    assert analyze(noisy, spec(type="trend", metrics=REV, time={"column": "date", "grain": "month"}), ROLES)["direction"] == "no clear trend"


def test_forecast_accuracy_on_unseen_months():
    """Fit on 36 months, compare the 6-month forecast with the 6 months it never saw."""
    rng = np.random.default_rng(1)
    months = pd.date_range("2022-01-01", periods=42, freq="MS")
    truth = np.array([2000 + 25 * i + 400 * np.sin(2 * np.pi * i / 12) for i in range(42)])
    df = pd.DataFrame({"date": months + pd.Timedelta(days=2), "revenue": truth + rng.normal(0, 40, 42)})
    train = df.iloc[:36]
    res = analyze(train, spec(type="forecast", metrics=REV, time={"column": "date", "grain": "month"}, options={"horizon": 6}), ROLES)
    pred = np.array([f["value"] for f in res["forecast"]])
    mape = np.mean(np.abs(pred - truth[36:]) / truth[36:])
    assert res["model"]["name"].startswith("holt_winters")
    assert mape < 0.08, mape
    covered = np.mean([(f["lo95"] <= t <= f["hi95"]) for f, t in zip(res["forecast"], truth[36:])])
    assert covered >= 0.8
    assert all(f["lo80"] <= f["value"] <= f["hi80"] and f["lo95"] <= f["lo80"] for f in res["forecast"])
    assert res["backtest"]["improvement_pct"] > 30


def test_forecast_prefers_simple_models_and_refuses_short_history():
    rng = np.random.default_rng(2)
    weeks = pd.date_range("2025-01-06", periods=30, freq="W-MON")
    flat = pd.DataFrame({"date": weeks, "revenue": rng.normal(500, 60, 30)})
    res = analyze(flat, spec(type="forecast", metrics=REV, time={"column": "date", "grain": "week"}), ROLES)
    assert res["model"]["name"] in ("naive", "moving_average", "ses")  # no trend or season in pure noise
    assert any("two full years" in n for n in res["notes"])  # 30 weeks: too short for a yearly season
    assert len(res["forecast"]) == 8  # default horizon for weeks
    short = flat.iloc[:5]
    with pytest.raises(AnalysisError, match="at least 8"):
        analyze(short, spec(type="forecast", metrics=REV, time={"column": "date", "grain": "week"}), ROLES)


def test_forecast_excludes_partial_last_period():
    months = pd.date_range("2025-01-01", periods=14, freq="MS")
    df = pd.DataFrame({"date": list(months + pd.Timedelta(days=1)) + [pd.Timestamp("2026-03-03")], "revenue": [100.0] * 14 + [5.0]})
    res = analyze(df, spec(type="forecast", metrics=REV, time={"column": "date", "grain": "month"}), ROLES)
    assert res["history"][-1]["period"].startswith("2026-02")
    assert any("incomplete" in n for n in res["notes"])
    assert all(f["value"] >= 0 and f["lo95"] >= 0 for f in res["forecast"])


@pytest.mark.parametrize("dates", [
    pd.date_range("2024-01-01", periods=24, freq="MS"),   # dated the 1st
    pd.date_range("2024-01-31", periods=24, freq="ME"),   # dated month-end
])
def test_monthly_summary_data_keeps_its_last_month(dates):
    """One row per month on a consistent day: every month is complete, including the last."""
    df = pd.DataFrame({"date": dates, "revenue": [1000.0 + 10 * i for i in range(24)]})
    res = analyze(df, spec(type="forecast", metrics=REV, time={"column": "date", "grain": "month"}), ROLES)
    assert res["history"][-1]["period"].startswith("2025-12")
    assert res["forecast"][0]["period"].startswith("2026-01")
    from app.analysis.compute import run_dashboard
    assert run_dashboard(df, ROLES)["period"]["current"] == "December 2025"


def test_sparse_irregular_orders_still_detect_a_partial_month():
    """About one order a month on random days is transaction data, not a summary."""
    rng = np.random.default_rng(4)
    dates = [pd.Timestamp(2025, m, int(rng.integers(1, 28))) for m in range(1, 13)] + [pd.Timestamp(2026, 1, 1), pd.Timestamp(2026, 1, 5)]
    df = pd.DataFrame({"date": dates, "revenue": 100.0})
    res = analyze(df, spec(type="forecast", metrics=REV, time={"column": "date", "grain": "month"}), ROLES)
    assert res["history"][-1]["period"].startswith("2025-12")
    assert any("incomplete" in n for n in res["notes"])



def test_noisy_small_store_flags_only_real_outliers():
    """Four orders a day means daily totals swing by a third routinely; only the planted
    huge order and the planted spike day should be flagged, and the outlier must not be
    absorbed into its own expected value."""
    rng = np.random.default_rng(11)
    rows = []
    for d in pd.date_range("2024-10-01", "2026-09-27", freq="D"):
        week = 0.5 if d.dayofweek >= 5 else 1.0
        spike = 4.0 if d == pd.Timestamp("2026-03-11") else 1.0
        for k in range(4):
            rows.append({"date": d, "revenue": int(rng.integers(1, 6)) * 40 * week * spike})
    df = pd.DataFrame(rows)
    df.loc[500, "revenue"] = 45000.0
    res = analyze(df, spec(type="anomalies", metrics=REV, time={"column": "date", "grain": "day"}, options={"scope": "time"}), ROLES)
    found = {f["period"][:10] for f in res["flags"]}
    assert {"2025-02-03", "2026-03-11"} <= found
    assert len(found) <= 4, found
    huge = next(f for f in res["flags"] if f["period"].startswith("2025-02-03"))
    assert huge["expected"] < 1000  # the outlier did not set its own baseline



def test_group_anomalies_see_through_seasonality():
    """Every region swings +/-25% with the seasons and grows; only Northeast's collapse is unusual."""
    rows = []
    for i, m in enumerate(pd.date_range("2024-10-01", "2026-08-01", freq="MS")):
        season = 1 + 0.25 * np.sin(2 * np.pi * (m.month - 3) / 12)
        for r in ["Northeast", "South", "West", "Midwest"]:
            v = 3000 * season * (1 + 0.012 * i)
            if r == "Northeast" and m == pd.Timestamp("2026-08-01"):
                v *= 0.3
            rows.append({"date": m + pd.Timedelta(days=4), "region": r, "revenue": v})
    res = analyze(pd.DataFrame(rows), spec(type="anomalies", metrics=REV, dimensions=["region"], time={"column": "date", "grain": "month"}, options={"scope": "groups"}), ROLES)
    assert [g["value"] for g in res["flags"]] == ["Northeast"]
    ne = res["flags"][0]
    assert ne["typical_share"] == pytest.approx(25, abs=1) and ne["share"] < 10



def test_trend_direction_survives_one_extreme_period():
    """Steady growth with one huge month early on: still rising."""
    months = pd.date_range("2025-01-01", periods=20, freq="MS")
    vals = [1000 + 30 * i for i in range(20)]
    vals[1] = 9000  # one extreme month
    df = pd.DataFrame({"date": months + pd.Timedelta(days=1), "revenue": vals})
    res = analyze(df, spec(type="trend", metrics=REV, time={"column": "date", "grain": "month"}), ROLES)
    assert res["direction"] == "rising"
    assert res["slope"] == pytest.approx(30, abs=3)
