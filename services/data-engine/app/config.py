"""Settings read from environment variables. Defaults suit local development."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ENGINE_VERSION = "0.2.0"


@dataclass(frozen=True)
class Settings:
    api_key: str
    data_dir: Path
    max_upload_bytes: int
    max_rows: int
    max_columns: int
    max_concurrent_jobs: int
    environment: str


def load_settings() -> Settings:
    env = os.getenv("ENGINE_ENV", "development")
    api_key = os.getenv("ENGINE_API_KEY", "")
    if len(api_key) < 16:
        # Never run without a real shared secret between the web app and the engine.
        raise RuntimeError("ENGINE_API_KEY must be set to at least 16 characters")
    return Settings(
        api_key=api_key,
        data_dir=Path(os.getenv("ENGINE_DATA_DIR", "./data")).resolve(),
        max_upload_bytes=int(os.getenv("ENGINE_MAX_UPLOAD_MB", "50")) * 1024 * 1024,
        max_rows=int(os.getenv("ENGINE_MAX_ROWS", "2000000")),
        max_columns=int(os.getenv("ENGINE_MAX_COLUMNS", "500")),
        max_concurrent_jobs=int(os.getenv("ENGINE_MAX_CONCURRENT_JOBS", "2")),
        environment=env,
    )
