import json

import pandas as pd

from app.profiling.profile import profile_dataframe
from app.profiling.quality import quality_score
from app.profiling.roles import infer_role
from app.profiling.types import infer_column


def col(profile, name):
    return next(c for c in profile["columns"] if c["name"] == name)


def test_currency_text_becomes_numeric_with_invalids_counted():
    values = ["$10.00"] * 99 + ["call for price"]
    tc = infer_column(pd.Series(values, dtype=object), "price")
    assert tc.logical_type == "numeric"
    assert tc.invalid_count == 1
    assert tc.series.dropna().sum() == 990


def test_mostly_text_column_is_not_forced_to_numbers():
    tc = infer_column(pd.Series(["10", "abc", "def", "20"] * 5, dtype=object), "code_like")
    assert tc.logical_type != "numeric"


def test_repeating_ids_are_identifiers():
    tc = infer_column(pd.Series([f"C{i % 7}" for i in range(500)], dtype=object), "customer_id")
    assert tc.logical_type == "identifier"
    assert infer_role("customer_id", tc, 500).concept == "customer"


def test_roles_require_data_to_agree_with_name():
    revenue_text = infer_column(pd.Series(["high", "low", "high"] * 10, dtype=object), "revenue")
    assert infer_role("revenue", revenue_text, 30).role != "monetary"

    fractional = infer_column(pd.Series([1.5, 2.25, 3.0] * 10), "quantity")
    r = infer_role("quantity", fractional, 30)
    assert r.role == "metric" and any("fractions" in x for x in r.rejected)

    negative_price = infer_column(pd.Series([-5.0, -3.0, 4.0, -1.0] * 10), "price")
    assert infer_role("price", negative_price, 40).role != "monetary"

    profit = infer_column(pd.Series([-5.0, 3.0, 4.0, 1.0] * 10), "profit")
    assert infer_role("profit", profit, 40).role == "monetary"  # profit may be negative


def test_sales_profile_matches_known_properties(sales_df):
    typed, profile = profile_dataframe(sales_df)
    assert profile["row_count"] == 403
    assert profile["column_count"] == 7
    assert profile["duplicate_rows"] == 3

    assert col(profile, "order_date")["logical_type"] == "datetime"
    assert col(profile, "order_date")["role"]["role"] == "time"
    assert col(profile, "order_date")["stats"]["granularity"] == "daily"

    rev = col(profile, "revenue")
    assert rev["logical_type"] == "numeric" and rev["converted_from"] == "text with currency symbols"
    assert rev["role"] == {**rev["role"], "role": "monetary", "concept": "revenue"}
    assert rev["stats"]["max"] == 99999
    assert rev["stats"]["outlier_count"] >= 1

    cust = col(profile, "customer_id")
    assert cust["role"]["role"] == "identifier" and cust["role"]["concept"] == "customer"
    assert col(profile, "order_id")["role"]["role"] == "identifier"
    assert col(profile, "region")["role"]["role"] == "geographic"
    assert col(profile, "units")["role"]["role"] == "quantity"

    notes = col(profile, "notes")
    assert notes["missing_count"] == 393
    assert any(w["column"] == "notes" and "optional" in w["message"] for w in profile["warnings"])

    # Typed frame keeps real types for later analysis
    assert str(typed["order_date"].dtype).startswith("datetime64")
    assert float(typed["revenue"].sum()) > 0


    json.dumps(profile)  # fully JSON-serializable


def test_quality_score_breakdown_is_explained():
    cols = [
        {"name": "a", "unique_count": 1, "missing_count": 0, "invalid_count": 0, "non_null_count": 100, "stats": {}},
        {"name": "b", "unique_count": 50, "missing_count": 10, "invalid_count": 3, "non_null_count": 90, "stats": {"outlier_count": 9}},
        {"name": "notes", "unique_count": 1, "missing_count": 90, "invalid_count": 0, "non_null_count": 10, "stats": {}},
    ]
    q = quality_score(n_rows=100, n_cols=3, missing_cells=100, duplicate_rows=2, columns=cols)
    factors = {i["factor"]: i["penalty"] for i in q["breakdown"]}
    assert factors == {
        "sparse_columns": 2.0,      # notes: 90% empty, flagged once
        "missing_values": 10.0,     # 10 of 200 cells in a and b = 5% -> 10
        "duplicate_rows": 4.0,
        "unreadable_values": 2.0,
        "constant_columns": 3.0,    # a only; sparse notes isn't double-counted
        "outliers": 10.0,           # 9 of 90 numeric values = 10%
    }
    assert q["score"] == 69


def test_optional_sparse_column_does_not_dominate_score(sales_df):
    _, profile = profile_dataframe(sales_df)  # "notes" is 97% empty
    assert profile["quality"]["score"] >= 90
    factors = [i["factor"] for i in profile["quality"]["breakdown"]]
    assert "sparse_columns" in factors and "constant_columns" not in factors


def test_clean_data_scores_100():
    df = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=50), "sales": range(50), "region": ["N", "S"] * 25})
    _, profile = profile_dataframe(df)
    assert profile["quality"]["score"] == 100
    assert profile["quality"]["breakdown"] == []


def test_no_date_column_produces_guidance():
    _, profile = profile_dataframe(pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]}))
    assert any("No date column" in w["message"] for w in profile["warnings"])


def test_strong_relationship_found_despite_one_extreme_value():
    units = list(range(1, 201))
    cost = [u * 8.5 for u in units]
    cost[10] = 1_000_000  # a single bad entry
    _, profile = profile_dataframe(pd.DataFrame({"units": units, "cost": cost}))
    pair = profile["correlations"][0]
    assert {pair["a"], pair["b"]} == {"units", "cost"}
    assert pair["spearman"] > 0.95
    assert pair["pearson"] < 0.7  # Pearson alone would have missed it


def test_weak_relationships_are_not_reported():
    import numpy as np
    rng = np.random.default_rng(1)
    _, profile = profile_dataframe(pd.DataFrame({"a": rng.normal(size=300), "b": rng.normal(size=300)}))
    assert profile["correlations"] == []
