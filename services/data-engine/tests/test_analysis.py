"""Every engine result is checked against an independent pandas calculation."""
import numpy as np
import pandas as pd
import pytest

from app.analysis.compute import AnalysisError, analyze
from app.analysis.models import AnalysisSpec, ColumnRole
from app.profiling.profile import profile_dataframe


@pytest.fixture
def typed(sales_df):
    df, profile = profile_dataframe(sales_df)
    roles = [ColumnRole(name=c["name"], logical_type=c["logical_type"], role=c["role"]["role"], concept=c["role"]["concept"]) for c in profile["columns"]]
    return df, roles


def spec(**kw):
    return AnalysisSpec.model_validate(kw)


def fact(res, label_part):
    return next(f for f in res["facts"] if label_part in f["label"])


def test_revenue_by_region_matches_pandas(typed):
    df, roles = typed
    res = analyze(df, spec(type="aggregate", metrics=[{"column": "revenue", "agg": "sum", "label": "Revenue"}], dimensions=["region"]), roles)
    expected = df.groupby("region")["revenue"].sum().sort_values(ascending=False)
    got = {r["region"]: r["Revenue"] for r in res["table"]["rows"]}
    for region, value in expected.items():
        assert got[region] == pytest.approx(value)
    assert res["table"]["rows"][0]["region"] == expected.index[0]  # sorted, best first
    assert fact(res, "Total Revenue")["value"] == pytest.approx(df["revenue"].sum())


def test_monthly_trend_in_time_order(typed):
    df, roles = typed
    res = analyze(df, spec(type="aggregate", metrics=[{"column": "revenue", "agg": "sum", "label": "Revenue"}],
                           time={"column": "order_date", "grain": "month"}), roles)
    expected = df.groupby(df["order_date"].dt.to_period("M"))["revenue"].sum()
    rows = res["table"]["rows"]
    assert len(rows) == len(expected)
    assert [r["Revenue"] for r in rows] == pytest.approx(list(expected.values))
    assert rows[0]["order_date"] < rows[-1]["order_date"]
    assert res["chart"]["kind"] == "line"
    assert fact(res, "First period")["display"] == "January 2026"


def test_filters_are_case_insensitive_and_report_unknown_values(typed):
    df, roles = typed
    res = analyze(df, spec(type="aggregate", metrics=[{"column": "revenue", "agg": "sum", "label": "Revenue"}],
                           filters=[{"column": "region", "op": "eq", "values": ["northeast"]}]), roles)
    assert res["table"]["rows"][0]["Revenue"] == pytest.approx(df.loc[df.region == "Northeast", "revenue"].sum())
    with pytest.raises(AnalysisError) as e:
        analyze(df, spec(type="aggregate", metrics=[{"column": "revenue", "agg": "sum", "label": "R"}],
                         filters=[{"column": "region", "op": "eq", "values": ["Nrtheast"]}]), roles)
    assert "Closest values: Northeast" in e.value.message


def test_ratio_metric(typed):
    df, roles = typed
    res = analyze(df, spec(type="aggregate", dimensions=["region"],
                           metrics=[{"column": "revenue", "agg": "sum", "label": "Revenue"}, {"column": "units", "agg": "sum", "label": "Units"}],
                           ratio={"numerator": 0, "denominator": 1, "label": "Revenue per unit", "as_percent": False}), roles)
    for r in res["table"]["rows"]:
        assert r["Revenue per unit"] == pytest.approx(r["Revenue"] / r["Units"])


def test_compare_latest_complete_month(typed):
    df, roles = typed
    # sales_df runs Jan 1 to Feb 4 2027 (400 days); latest complete month is Jan 2027
    res = analyze(df, spec(type="compare_periods", metrics=[{"column": "revenue", "agg": "sum", "label": "Revenue"}],
                           dimensions=["region"], time={"column": "order_date"},
                           period={"kind": "latest_complete", "unit": "month"}, comparison="previous_period"), roles)
    cur = df[(df.order_date >= "2027-01-01") & (df.order_date < "2027-02-01")]
    base = df[(df.order_date >= "2026-12-01") & (df.order_date < "2027-01-01")]
    assert res["period"]["current"]["label"] == "January 2027"
    assert res["period"]["baseline"]["label"] == "December 2026"
    assert res["summary"]["current"] == pytest.approx(cur.revenue.sum())
    assert res["summary"]["baseline"] == pytest.approx(base.revenue.sum())
    change = cur.revenue.sum() - base.revenue.sum()
    rows = res["contributors"][0]["rows"]
    # contributions add up to the total change
    full = (cur.groupby("region").revenue.sum() - base.groupby("region").revenue.sum()).fillna(0)
    assert full.sum() == pytest.approx(change)
    assert sum(r["share_of_change"] for r in rows) == pytest.approx(100)
    # biggest mover in the direction of the total change comes first
    assert rows[0]["value"] == (full.idxmin() if change < 0 else full.idxmax())


def test_latest_period_flagged_partial(typed):
    df, roles = typed
    res = analyze(df, spec(type="compare_periods", metrics=[{"column": "revenue", "agg": "sum", "label": "Revenue"}],
                           time={"column": "order_date"}, period={"kind": "latest", "unit": "month"}, comparison="previous_period"), roles)
    assert res["period"]["current"]["partial"] is True
    assert any("incomplete" in n for n in res["notes"])


def test_overview_totals(typed):
    df, roles = typed
    res = analyze(df, spec(type="overview"), roles)
    assert fact(res, "Total revenue")["value"] == pytest.approx(df.revenue.sum())
    assert fact(res, "Distinct customer_id")["value"] == df.customer_id.nunique()
    assert fact(res, "Top region by revenue")["kind"] == "text"


def test_digits_only_in_facts_not_free_labels(typed):
    df, roles = typed
    res = analyze(df, spec(type="compare_periods", metrics=[{"column": "revenue", "agg": "sum", "label": "Revenue"}],
                           time={"column": "order_date"}, period={"kind": "latest_complete", "unit": "month"}, comparison="previous_period"), roles)
    assert fact(res, "Current period")["display"] == "January 2027"
    pct = fact(res, "absolute percent")
    assert pct["display"].endswith("%") and pct["value"] >= 0


def test_useful_errors(typed):
    df, roles = typed
    with pytest.raises(AnalysisError, match="Did you mean"):
        analyze(df, spec(type="aggregate", metrics=[{"column": "revenu", "agg": "sum", "label": "R"}]), roles)
    with pytest.raises(AnalysisError, match="isn't numeric"):
        analyze(df, spec(type="aggregate", metrics=[{"column": "region", "agg": "sum", "label": "R"}]), roles)


def test_spec_validation_rejects_incomplete_plans():
    with pytest.raises(ValueError):
        spec(type="compare_periods", metrics=[{"column": "revenue", "agg": "sum", "label": "R"}])
    with pytest.raises(ValueError):
        spec(type="aggregate", metrics=[{"column": None, "agg": "sum", "label": "R"}])
    with pytest.raises(ValueError):
        spec(type="aggregate", metrics=[{"column": "a", "agg": "sum", "label": "R"}], ratio={"numerator": 0, "denominator": 2, "label": "x"})


def test_distribution_integer_values_get_one_bar_each(typed):
    df, roles = typed
    res = analyze(df, spec(type="distribution", metrics=[{"column": "units", "agg": "sum", "label": "Units"}]), roles)
    counts = df["units"].value_counts()
    assert {b["start"]: b["count"] for b in res["bins"]} == {int(k): int(v) for k, v in counts.items()}
    assert sum(b["share"] for b in res["bins"]) == pytest.approx(100)
    assert fact(res, "Median Units")["value"] == pytest.approx(df.units.median())


def test_distribution_continuous_values_are_binned(typed):
    df, roles = typed
    res = analyze(df, spec(type="distribution", metrics=[{"column": "revenue", "agg": "sum", "label": "Revenue"}]), roles)
    assert 8 <= len(res["bins"]) <= 30
    assert sum(b["count"] for b in res["bins"]) == df.revenue.notna().sum()
    assert res["chart"]["kind"] == "histogram"
    assert fact(res, "Unusually high or low values")["value"] >= 1  # the planted 99,999 order


def test_dashboard_kpis_match_pandas(typed):
    from app.analysis.compute import run_dashboard
    df, roles = typed
    out = run_dashboard(df, roles)
    cur = df[(df.order_date >= "2027-01-01") & (df.order_date < "2027-02-01")]
    base = df[(df.order_date >= "2026-12-01") & (df.order_date < "2027-01-01")]
    k = {x["key"]: x for x in out["kpis"]}
    assert out["period"] == {"current": "January 2027", "baseline": "December 2026"}
    assert k["value"]["value"] == pytest.approx(cur.revenue.sum())
    assert k["value"]["change_pct"] == pytest.approx(100 * (cur.revenue.sum() - base.revenue.sum()) / base.revenue.sum())
    assert k["orders"]["value"] == cur.order_id.nunique()
    assert k["customers"]["value"] == cur.customer_id.nunique()
    assert k["aov"]["value"] == pytest.approx(cur.revenue.sum() / cur.order_id.nunique())
    assert len(out["series"]) == df.order_date.dt.to_period("M").nunique()
    assert [s["partial"] for s in out["series"]][-2:] == [False, True]  # February 2027 is incomplete
    assert out["movers"][0]["dimension"] == "region" and len(out["movers"][0]["rows"]) == 3


def test_dashboard_without_money_columns_explains():
    from app.analysis.compute import run_dashboard
    df = pd.DataFrame({"name": ["a", "b"]})
    out = run_dashboard(df, [ColumnRole(name="name", logical_type="categorical", role="category")])
    assert out["kpis"] == [] and "No revenue" in out["notes"][0]



def test_monthly_trend_flags_partial_last_month(typed):
    df, roles = typed   # data ends Feb 4, 2027
    res = analyze(df, spec(type="aggregate", metrics=[{"column": "revenue", "agg": "sum", "label": "Revenue"}],
                           time={"column": "order_date", "grain": "month"}), roles)
    assert res["table"]["rows"][-1].get("partial") is True
    assert fact(res, "Last period")["display"] == "January 2027"   # trend figures stop at the last complete month
    assert any("February 2027 is incomplete" in n for n in res["notes"])
