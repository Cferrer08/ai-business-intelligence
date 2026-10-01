import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("ENGINE_API_KEY", "test-key-0123456789")


@pytest.fixture
def sales_df() -> pd.DataFrame:
    """A realistic sales table with known properties used across tests."""
    rng = np.random.default_rng(42)
    n = 400
    dates = pd.date_range("2026-01-01", periods=n, freq="D")
    units = rng.integers(1, 20, n)
    price = rng.choice([19.99, 49.5, 120.0], n)
    df = pd.DataFrame({
        "order_id": [f"ORD-{i:05d}" for i in range(n)],
        "order_date": dates.strftime("%Y-%m-%d"),
        "customer_id": [f"C{int(x):03d}" for x in rng.integers(1, 60, n)],
        "region": rng.choice(["Northeast", "South", "West", "Midwest"], n),
        "units": units,
        "revenue": [f"${u * p:,.2f}" for u, p in zip(units, price)],
        "notes": [None] * (n - 10) + ["called back"] * 10,
    })
    df.loc[5, "revenue"] = "$99,999.00"  # one obvious outlier
    df = pd.concat([df, df.iloc[[0, 1, 2]]], ignore_index=True)  # 3 duplicate rows
    return df
