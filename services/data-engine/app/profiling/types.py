"""Infer each column's logical type and convert it to a proper dtype.

Uploaded data is often stored as text: "$1,204.50", "12%", "2026-03-01", "Yes". A column is
converted only when nearly all of its non-empty values agree (thresholds below), and every
conversion is recorded so the profile can say exactly what happened. Values that don't
fit are counted as invalid, never silently invented.
"""
from __future__ import annotations

import re
import warnings
from dataclasses import dataclass

import numpy as np
import pandas as pd

NUMERIC_THRESHOLD = 0.95
DATE_THRESHOLD = 0.90
BOOL_TOKENS = {"true": True, "false": False, "yes": True, "no": False, "y": True, "n": False, "t": True, "f": False}

_CURRENCY = re.compile(r"^\s*\(?\s*[-+]?\s*[$€£¥]?\s*[-+]?\s*[\d.,]+\s*[$€£¥]?\s*\)?\s*$")
_PERCENT = re.compile(r"^\s*[-+]?[\d.,]+\s*%\s*$")
_DATE_LIKE = re.compile(
    r"^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|"
    r"\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{2,4}|\d{4}-\d{2})([ T]\d{1,2}:\d{2}.*)?\s*$"
)
_ID_NAME = re.compile(r"(^|_)(id|uuid|guid|sku|code|key|number|no)$")


@dataclass
class TypedColumn:
    series: pd.Series
    logical_type: str  # numeric | datetime | boolean | categorical | text | identifier
    converted_from: str | None = None  # human description of a conversion, if any
    invalid_count: int = 0  # non-empty values that didn't fit the inferred type
    is_integer: bool = False


def split_name(name: str) -> list[str]:
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name)
    return [t for t in re.split(r"[^a-zA-Z0-9]+", s.lower()) if t]


def _to_number(text: pd.Series) -> tuple[pd.Series, str | None]:
    """Parse currency/percent/thousand-separated text. Returns numbers and a description."""
    s = text.str.strip()
    currency = s.str.contains(r"[$€£¥]", regex=True)
    percent = s.str.endswith("%")
    negative_paren = s.str.match(r"^\(.*\)$")
    cleaned = s.str.replace(r"[$€£¥%\s()]", "", regex=True)
    # European "1.234,50" -> "1234.50" only when commas are clearly decimals
    euro = cleaned.str.match(r"^-?\d{1,3}(\.\d{3})+,\d+$") | cleaned.str.match(r"^-?\d+,\d{1,2}$")
    cleaned = cleaned.where(~euro, cleaned.str.replace(".", "", regex=False).str.replace(",", ".", regex=False))
    cleaned = cleaned.str.replace(",", "", regex=False)
    values = pd.to_numeric(cleaned, errors="coerce")
    values = values.where(~negative_paren, -values.abs())
    values = values.where(~percent, values / 100)
    desc = None
    if euro.mean() > 0.5:
        desc = "numbers with comma decimals (1.234,50 read as 1234.50)"
    elif currency.mean() > 0.5:
        desc = "text with currency symbols"
    elif percent.mean() > 0.5:
        desc = "percentages (stored as fractions, so 12% is 0.12)"
    elif s.str.contains(",", regex=False).mean() > 0.2:
        desc = "text with thousands separators"
    elif desc is None:
        desc = "numbers stored as text"
    return values, desc


def _string_kind(series: pd.Series, name: str, n_rows: int) -> str:
    non_null = series.dropna().astype(str)
    if non_null.empty:
        return "text"
    unique = non_null.nunique()
    unique_ratio = unique / len(non_null)
    avg_len = non_null.str.len().mean()
    has_spaces = non_null.str.contains(" ", regex=False).mean()
    id_name = bool(_ID_NAME.search("_".join(split_name(name))))
    # An id-named column is an identifier even when values repeat (customers, products, stores).
    if (id_name and unique >= 2) or (unique_ratio > 0.95 and avg_len <= 40 and has_spaces < 0.1 and len(non_null) >= 20):
        return "identifier"
    if unique <= max(50, int(0.05 * n_rows)) and avg_len <= 60:
        return "categorical"
    return "text"


def _looks_day_first(text: pd.Series) -> bool:
    """For a/b/yyyy dates: day-first if some first parts exceed 12 and no second parts do."""
    parts = text.str.extract(r"^\s*(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}")
    parts = parts.dropna().astype(int)
    if parts.empty:
        return False
    return bool((parts[0] > 12).any() and not (parts[1] > 12).any())


def infer_column(series: pd.Series, name: str) -> TypedColumn:
    n_rows = len(series)
    non_null = series.dropna()

    if pd.api.types.is_bool_dtype(series):
        return TypedColumn(series.astype("boolean"), "boolean")

    if pd.api.types.is_datetime64_any_dtype(series):
        s = series.dt.tz_localize(None) if getattr(series.dt, "tz", None) is not None else series
        return TypedColumn(s, "datetime")

    if pd.api.types.is_numeric_dtype(series):
        finite = non_null[np.isfinite(non_null.astype(float))] if len(non_null) else non_null
        is_int = bool(len(finite)) and bool((finite % 1 == 0).all())
        tokens = split_name(name)
        id_name = bool(_ID_NAME.search("_".join(tokens)))
        if id_name and is_int and non_null.nunique() >= 2:
            return TypedColumn(series, "identifier", is_integer=True)
        # 0/1 flags
        if is_int and len(non_null) and set(non_null.unique()) <= {0, 1} and n_rows >= 20:
            return TypedColumn(series.astype("boolean"), "boolean", converted_from="0/1 values")
        return TypedColumn(series, "numeric", is_integer=is_int)

    # Text-like (object / string dtype)
    text = non_null.astype(str).str.strip()
    text = text[text != ""]
    if text.empty:
        return TypedColumn(series.astype("string"), "text")

    lowered = text.str.lower()
    if lowered.isin(BOOL_TOKENS).mean() == 1.0 and lowered.nunique() <= 2:
        converted = series.astype("string").str.strip().str.lower().map(BOOL_TOKENS).astype("boolean")
        return TypedColumn(converted, "boolean", converted_from="yes/no or true/false text")

    numeric_like = text.str.match(_CURRENCY) | text.str.match(_PERCENT)
    if numeric_like.mean() >= NUMERIC_THRESHOLD:
        parsed, desc = _to_number(series.astype("string").fillna(""))
        parsed = parsed.where(series.notna())
        invalid = int(parsed.isna().sum() - series.isna().sum())
        is_int = bool(parsed.dropna().mod(1).eq(0).all())
        tokens = split_name(name)
        if bool(_ID_NAME.search("_".join(tokens))) and is_int:
            return TypedColumn(series.astype("string"), "identifier")
        return TypedColumn(parsed.astype("Float64"), "numeric", converted_from=desc, invalid_count=max(invalid, 0), is_integer=is_int)

    date_like = text.str.match(_DATE_LIKE)
    if date_like.mean() >= DATE_THRESHOLD:
        dayfirst = _looks_day_first(text)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            parsed = pd.to_datetime(series.astype("string"), errors="coerce", format="mixed", dayfirst=dayfirst)
        ok = parsed.notna().sum() / max(1, len(text))
        if ok >= DATE_THRESHOLD:
            if getattr(parsed.dt, "tz", None) is not None:
                parsed = parsed.dt.tz_convert(None)
            invalid = int(len(text) - parsed.notna().sum())
            desc = "dates stored as text (day first, so 03/04 is 3 April)" if dayfirst else "dates stored as text"
            return TypedColumn(parsed, "datetime", converted_from=desc, invalid_count=invalid)

    kind = _string_kind(series, name, n_rows)
    return TypedColumn(series.astype("string"), kind)


def infer_types(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, TypedColumn]]:
    typed: dict[str, TypedColumn] = {}
    out = {}
    for col in df.columns:
        tc = infer_column(df[col], col)
        typed[col] = tc
        out[col] = tc.series
    return pd.DataFrame(out), typed
