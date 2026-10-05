"""Analysis requests the engine accepts. The AI planner can only produce these shapes,
and the engine validates them again here (defense in depth). No code is ever executed."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Agg = Literal["sum", "mean", "median", "count", "count_distinct", "min", "max"]
Grain = Literal["day", "week", "month", "quarter", "year"]
FilterOp = Literal["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "between", "contains"]


class Metric(BaseModel):
    column: str | None = Field(default=None, max_length=120)  # None with agg=count counts rows
    agg: Agg
    label: str = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def column_required(self):
        if self.column is None and self.agg != "count":
            raise ValueError(f"metric '{self.label}' needs a column for {self.agg}")
        return self


class Ratio(BaseModel):
    numerator: int = Field(ge=0, le=2)
    denominator: int = Field(ge=0, le=2)
    label: str = Field(min_length=1, max_length=80)
    as_percent: bool = True


class TimeSpec(BaseModel):
    column: str = Field(max_length=120)
    grain: Grain | None = None


class Filter(BaseModel):
    column: str = Field(max_length=120)
    op: FilterOp
    values: list[str] = Field(min_length=1, max_length=50)


class Period(BaseModel):
    kind: Literal["all", "latest", "latest_complete", "absolute"]
    unit: Grain | None = None
    start: str | None = None
    end: str | None = None

    @model_validator(mode="after")
    def consistent(self):
        if self.kind in ("latest", "latest_complete") and not self.unit:
            raise ValueError("relative periods need a unit")
        if self.kind == "absolute" and not (self.start and self.end):
            raise ValueError("absolute periods need start and end")
        return self


class Sort(BaseModel):
    by: str = Field(max_length=120)
    direction: Literal["asc", "desc"] = "desc"


class Options(BaseModel):
    horizon: int | None = Field(default=None, ge=1, le=104)            # forecast: periods ahead
    scope: Literal["time", "records", "groups"] | None = None           # anomalies
    sensitivity: Literal["low", "normal", "high"] | None = None         # anomalies


ADVANCED = ("forecast", "anomalies", "correlation", "segmentation", "trend")


class AnalysisSpec(BaseModel):
    type: Literal["aggregate", "compare_periods", "overview", "distribution", "forecast", "anomalies", "correlation", "segmentation", "trend"]
    metrics: list[Metric] = Field(default_factory=list, max_length=3)
    ratio: Ratio | None = None
    dimensions: list[str] = Field(default_factory=list, max_length=2)
    time: TimeSpec | None = None
    filters: list[Filter] = Field(default_factory=list, max_length=10)
    period: Period | None = None
    comparison: Literal["previous_period", "same_period_last_year"] | None = None
    sort: Sort | None = None
    limit: int | None = Field(default=None, ge=1, le=500)
    options: Options | None = None

    @model_validator(mode="after")
    def by_type(self):
        if self.type in ("aggregate", "compare_periods", "distribution", "forecast", "trend") and not self.metrics:
            raise ValueError(f"{self.type} needs at least one metric")
        if self.type in ("forecast", "trend") and not self.time:
            raise ValueError(f"{self.type} needs a date column")
        if self.type == "compare_periods" and not (self.time and self.period and self.comparison):
            raise ValueError("compare_periods needs time, period and comparison")
        if self.ratio and max(self.ratio.numerator, self.ratio.denominator) >= len(self.metrics):
            raise ValueError("ratio refers to a metric that doesn't exist")
        if self.type == "distribution" and (self.metrics[0].column is None or self.dimensions):
            raise ValueError("distribution needs one numeric column and no dimensions")
        if len({m.label for m in self.metrics}) != len(self.metrics):
            raise ValueError("metric labels must be unique")
        return self


class ColumnRole(BaseModel):
    name: str
    logical_type: str
    role: str
    concept: str | None = None


class AnalyzeRequest(BaseModel):
    spec: AnalysisSpec
    # Column roles from the stored profile, so the engine knows what is money or a date.
    columns: list[ColumnRole] = Field(default_factory=list, max_length=500)

    @field_validator("columns")
    @classmethod
    def unique_names(cls, v):
        if len({c.name for c in v}) != len(v):
            raise ValueError("duplicate column names")
        return v


class DashboardRequest(BaseModel):
    columns: list[ColumnRole] = Field(default_factory=list, max_length=500)
