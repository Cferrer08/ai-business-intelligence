from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ErrorBody(BaseModel):
    code: str
    message: str


class IngestResponse(BaseModel):
    dataset_id: str
    file_format: str
    size_bytes: int
    read_notes: list[str] = Field(default_factory=list)
    encoding: str | None = None
    delimiter: str | None = None
    sheet: str | None = None
    engine_version: str
    profile: dict[str, Any]


class DeleteResponse(BaseModel):
    deleted: bool


class HealthResponse(BaseModel):
    status: str
    version: str
