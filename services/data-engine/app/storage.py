"""File storage for datasets, laid out as <data_dir>/<workspace_id>/<dataset_id>/.

Ids are UUIDs validated at the API boundary, so user input never becomes part of a path.
The user's original filename is never used on disk. Swap this module for object storage
(S3/R2) in production without touching profiling code.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from uuid import UUID

import pandas as pd

CANONICAL_NAME = "data.parquet"


def dataset_dir(root: Path, workspace_id: UUID, dataset_id: UUID) -> Path:
    path = (root / str(workspace_id) / str(dataset_id)).resolve()
    if root not in path.parents:  # defense in depth; UUIDs already prevent traversal
        raise ValueError("invalid dataset path")
    return path


def original_path(directory: Path, extension: str) -> Path:
    return directory / f"original.{extension}"


def write_canonical(directory: Path, df: pd.DataFrame) -> Path:
    """Typed copy of the data used by every later analysis. Written atomically."""
    directory.mkdir(parents=True, exist_ok=True)
    tmp = directory / f".{CANONICAL_NAME}.tmp"
    df.to_parquet(tmp, index=False, engine="pyarrow", compression="zstd")
    final = directory / CANONICAL_NAME
    os.replace(tmp, final)
    return final


def read_canonical(root: Path, workspace_id: UUID, dataset_id: UUID) -> pd.DataFrame:
    return pd.read_parquet(dataset_dir(root, workspace_id, dataset_id) / CANONICAL_NAME, engine="pyarrow")


def delete_dataset(root: Path, workspace_id: UUID, dataset_id: UUID) -> bool:
    directory = dataset_dir(root, workspace_id, dataset_id)
    if not directory.exists():
        return False
    shutil.rmtree(directory)
    return True
