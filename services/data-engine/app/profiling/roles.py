"""Infer what each column means for the business (its semantic role).

A column's name proposes a role; its data must confirm it. A column called "revenue" that
holds text, or a "quantity" with fractional values, is not given that role, and the
rejected suggestion is recorded with the reason. Later phases (the analysis planner) only
use roles that passed these checks.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from .types import TypedColumn, split_name

# concept -> (role, name tokens that suggest it)
CONCEPTS: dict[str, tuple[str, set[str]]] = {
    "revenue": ("monetary", {"revenue", "sales", "turnover", "income", "gmv"}),
    "amount": ("monetary", {"amount", "total", "subtotal", "value", "payment", "spend", "spent", "charge"}),
    "price": ("monetary", {"price", "msrp", "fee"}),
    "cost": ("monetary", {"cost", "cogs", "expense", "expenses"}),
    "profit": ("monetary", {"profit", "margin", "earnings", "net"}),
    "discount": ("monetary", {"discount", "refund", "refunds"}),
    "quantity": ("quantity", {"quantity", "qty", "units", "count", "volume", "stock", "inventory", "orders"}),
    "date": ("time", {"date", "time", "timestamp", "day", "month", "week", "year", "period", "created", "updated", "datetime"}),
    "customer": ("identifier", {"customer", "client", "buyer", "account", "user", "member"}),
    "product": ("identifier", {"product", "item", "sku", "variant", "vehicle", "vin", "model"}),
    "order": ("identifier", {"order", "invoice", "transaction", "receipt", "booking", "appointment"}),
    "employee": ("identifier", {"employee", "rep", "salesperson", "agent", "staff"}),
    "region": ("geographic", {"region", "country", "state", "province", "city", "zip", "zipcode", "postal", "postcode", "territory", "location", "market", "store", "branch"}),
    "channel": ("category", {"channel", "source", "medium", "campaign", "segment", "category", "type", "status", "department", "tier"}),
}
ID_TOKENS = {"id", "uuid", "guid", "sku", "code", "key", "number", "no", "vin"}
SIGNED_OK = {"profit", "amount", "discount"}  # may legitimately be negative


@dataclass
class RoleResult:
    role: str
    concept: str | None = None
    confidence: str = "low"  # high | medium | low
    evidence: list[str] = field(default_factory=list)
    rejected: list[str] = field(default_factory=list)


def _suggested(tokens: list[str]) -> list[str]:
    hits = []
    for concept, (_, words) in CONCEPTS.items():
        if any(t in words for t in tokens):
            hits.append(concept)
    return hits


def infer_role(name: str, tc: TypedColumn, n_rows: int) -> RoleResult:
    tokens = split_name(name)
    suggestions = _suggested(tokens)
    has_id_token = any(t in ID_TOKENS for t in tokens)
    s = tc.series.dropna()
    unique_ratio = (s.nunique() / len(s)) if len(s) else 0.0
    rejected: list[str] = []

    # Time
    if tc.logical_type == "datetime":
        ev = ["Values are dates"]
        if "date" in suggestions:
            ev.append("name suggests a date")
        return RoleResult("time", "date", "high" if tc.invalid_count == 0 else "medium", ev)
    if "date" in suggestions and not has_id_token and tc.logical_type != "numeric":
        rejected.append("Name suggests a date, but the values couldn't be read as dates.")

    # Identifiers (e.g. customer_id, order_number)
    if tc.logical_type == "identifier" or (has_id_token and tc.logical_type in {"categorical", "numeric"} and unique_ratio > 0.2):
        entity = next((c for c in suggestions if CONCEPTS[c][0] == "identifier"), None)
        ev = [f"{s.nunique():,} distinct values"]
        if has_id_token:
            ev.append("name marks it as an id")
        repeats = unique_ratio < 0.98
        if entity and repeats:
            ev.append(f"values repeat, so each {entity} appears on several rows")
        return RoleResult("identifier", entity, "high" if (entity or has_id_token) else "medium", ev, rejected)

    # Money and quantities
    if tc.logical_type == "numeric":
        money = [c for c in suggestions if CONCEPTS[c][0] == "monetary"]
        qty = "quantity" in suggestions
        negatives = float((s < 0).mean()) if len(s) else 0.0
        if money:
            concept = money[0]
            if negatives > 0.05 and concept not in SIGNED_OK:
                rejected.append(f"Name suggests {concept}, but {negatives:.0%} of values are negative.")
            else:
                ev = [f"name suggests {concept}", "values are numeric"]
                if tc.converted_from == "text with currency symbols":
                    ev.append("values had currency symbols")
                return RoleResult("monetary", concept, "high", ev, rejected)
        if tc.converted_from == "text with currency symbols":
            return RoleResult("monetary", "amount", "medium", ["values had currency symbols"], rejected)
        if qty:
            if tc.is_integer and negatives == 0:
                return RoleResult("quantity", "quantity", "high", ["name suggests a count", "whole, non-negative numbers"], rejected)
            rejected.append("Name suggests a quantity, but values include fractions or negatives.")
        return RoleResult("metric", None, "medium", ["numeric values"], rejected)

    # Geography and other dimensions
    if tc.logical_type in {"categorical", "text"}:
        if "region" in suggestions:
            if tc.logical_type == "categorical":
                return RoleResult("geographic", "region", "high", ["name suggests a place", f"{s.nunique():,} distinct values"], rejected)
            rejected.append("Name suggests a location, but there are too many distinct values for a grouping.")
        if tc.logical_type == "categorical":
            concept = next((c for c in suggestions if CONCEPTS[c][0] == "category"), None)
            entity = next((c for c in suggestions if CONCEPTS[c][0] == "identifier"), None)
            return RoleResult("category", concept or entity, "high" if (concept or entity) else "medium", [f"{s.nunique():,} distinct values"], rejected)
        return RoleResult("text", None, "medium", ["free text"], rejected)

    if tc.logical_type == "boolean":
        return RoleResult("flag", None, "high", ["true/false values"], rejected)

    return RoleResult("unknown", None, "low", [], rejected)
