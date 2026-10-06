from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.analysis.briefing import AlertRequest, BriefingRequest, run_alert_rows, run_briefing
from app.analysis.compute import AnalysisError
from app.analysis.models import ColumnRole

ROLES = [ColumnRole(name="date", logical_type="datetime", role="time", concept="date"),
         ColumnRole(name="order_id", logical_type="identifier", role="identifier", concept="order"),
         ColumnRole(name="region", logical_type="categorical", role="geographic", concept="region"),
         ColumnRole(name="revenue", logical_type="numeric", role="monetary", concept="revenue")]


@pytest.fixture
def daily():
    rows, n = [], 0
    for d in pd.date_range("2026-08-03", "2026-09-30", freq="D"):   # Mon Aug 3 .. Wed Sep 30
        for region in ["NE", "S", "W"]:
            v = 100.0 * (0.5 if d.dayofweek >= 5 else 1)
            if d == pd.Timestamp("2026-09-29") and region == "NE":   # latest complete day: NE drops
                v = 30.0
            rows.append({"date": d + pd.Timedelta(hours=10), "order_id": f"O{n}", "region": region, "revenue": v}); n += 1
    df = pd.DataFrame(rows)
    df.loc[len(df)] = {"date": pd.Timestamp("2026-09-30 09:00"), "order_id": "late", "region": "S", "revenue": 5.0}
    return df


def kpi(out, key):
    return next(k for k in out["kpis"] if k["key"] == key)


def test_daily_briefing_compares_same_weekday(daily):
    out = run_briefing(daily, BriefingRequest(unit="day", columns=ROLES, today=date(2026, 9, 30)))
    # Sep 30 is the last day in the data and complete by date-level data; latest complete day is Sep 30.
    assert out["period"]["current"].startswith("Wednesday, Sep 30") or out["period"]["current"].startswith("Tuesday, Sep 29")
    assert "Days are compared with the same weekday a week earlier." in out["notes"]


def test_daily_briefing_numbers(daily):
    df = daily[daily.order_id != "late"]   # data ends cleanly on Sep 30
    out = run_briefing(df, BriefingRequest(unit="day", columns=ROLES))
    assert out["period"]["current"] == "Wednesday, Sep 30, 2026"
    assert out["period"]["baseline"] == "Wednesday, Sep 23, 2026"
    out2 = run_briefing(df[df.date < "2026-09-30"], BriefingRequest(unit="day", columns=ROLES))
    assert out2["period"]["current"] == "Tuesday, Sep 29, 2026"
    assert kpi(out2, "value")["value"] == pytest.approx(230) and kpi(out2, "value")["baseline"] == pytest.approx(300)
    assert kpi(out2, "value")["change_pct"] == pytest.approx(-100 * 70 / 300)
    assert out2["movers"][0]["value"] == "NE" and out2["movers"][0]["change_pct"] == pytest.approx(-70)
    assert "NE" in out2["labels"]


def test_weekly_and_monthly_briefings(daily):
    w = run_briefing(daily, BriefingRequest(unit="week", columns=ROLES))
    assert w["period"]["current"].startswith("Sep 21") and w["period"]["baseline"].startswith("Sep 14")
    m = run_briefing(daily, BriefingRequest(unit="month", columns=ROLES))
    assert m["period"] == {**m["period"], "current": "September 2026", "baseline": "August 2026"}


def test_stale_data_is_flagged(daily):
    out = run_briefing(daily, BriefingRequest(unit="day", columns=ROLES, today=date(2026, 11, 2)))
    assert out["stale"] is True and "Upload newer data" in out["notes"][0]
    fresh = run_briefing(daily, BriefingRequest(unit="day", columns=ROLES, today=date(2026, 10, 1)))
    assert fresh["stale"] is False


def test_briefing_needs_columns():
    with pytest.raises(AnalysisError):
        run_briefing(pd.DataFrame({"a": [1]}), BriefingRequest(unit="day", columns=[]))


def test_alert_rows_against_value_and_column():
    inv = pd.DataFrame({"sku": ["A", "B", "C", "D"], "stock": [3, 50, 8, 0], "reorder_point": [5, 20, 10, 2]})
    roles = [ColumnRole(name="stock", logical_type="numeric", role="quantity"), ColumnRole(name="reorder_point", logical_type="numeric", role="metric")]
    by_col = run_alert_rows(inv, AlertRequest(column="stock", op="lt", value_column="reorder_point", label_columns=["sku"], columns=roles))
    assert by_col["matches"] == 3 and [r["sku"] for r in by_col["rows"]] == ["A", "C", "D"]
    assert by_col["condition"] == "stock below reorder_point"
    by_val = run_alert_rows(inv, AlertRequest(column="stock", op="lte", value=0, label_columns=["sku"], columns=roles))
    assert by_val["matches"] == 1
    with pytest.raises(AnalysisError):
        run_alert_rows(inv, AlertRequest(column="sku", op="lt", value=1, columns=roles))
