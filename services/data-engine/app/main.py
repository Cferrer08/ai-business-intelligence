"""InsightAI data engine. Only the web app calls it, using a shared key.

Endpoints:
  POST   /v1/workspaces/{workspace_id}/datasets/{dataset_id}/ingest   validate, store, profile
  POST   /v1/workspaces/{workspace_id}/datasets/{dataset_id}/analyze  run a validated analysis spec
  DELETE /v1/workspaces/{workspace_id}/datasets/{dataset_id}          remove stored files
  GET    /health
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Depends, FastAPI, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from . import storage
from .config import ENGINE_VERSION, load_settings
from .errors import EngineError, LimitExceeded
from .ingest import detect_format, read_dataset
from .analysis.compute import analyze as run_analysis
from .analysis.models import AnalyzeRequest
from .profiling.profile import profile_dataframe
from .schemas import DeleteResponse, HealthResponse, IngestResponse
from .security import require_engine_key

logger = logging.getLogger("engine")
logging.basicConfig(level=logging.INFO, format="%(message)s")


def log(level: int, event: str, **fields) -> None:
    logger.log(level, json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "event": event, **fields}, default=str))


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = load_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    app.state.settings = settings
    app.state.jobs = threading.BoundedSemaphore(settings.max_concurrent_jobs)
    log(logging.INFO, "engine.started", version=ENGINE_VERSION, data_dir=str(settings.data_dir))
    yield


app = FastAPI(title="InsightAI Data Engine", version=ENGINE_VERSION, lifespan=lifespan,
              docs_url=None if os.getenv("ENGINE_ENV") == "production" else "/docs", redoc_url=None)


@app.exception_handler(EngineError)
async def engine_error_handler(_: Request, exc: EngineError):
    return JSONResponse(status_code=exc.status_code, content={"detail": {"code": exc.code, "message": exc.message}})


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    log(logging.ERROR, "engine.unhandled_error", path=request.url.path, error=repr(exc))
    return JSONResponse(status_code=500, content={"detail": {"code": "internal_error", "message": "The data engine hit an unexpected error."}})


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=ENGINE_VERSION)


def _save_upload(upload: UploadFile, destination, limit: int) -> int:
    """Stream to disk, stopping as soon as the size limit is passed."""
    written = 0
    with destination.open("wb") as out:
        while chunk := upload.file.read(1024 * 1024):
            written += len(chunk)
            if written > limit:
                raise LimitExceeded("file_too_large", f"The file is larger than the {limit // (1024 * 1024)} MB limit.")
            out.write(chunk)
    return written


@app.post("/v1/workspaces/{workspace_id}/datasets/{dataset_id}/ingest", response_model=IngestResponse,
          dependencies=[Depends(require_engine_key)])
def ingest(request: Request, workspace_id: UUID, dataset_id: UUID,
           file: UploadFile = File(...), filename: str = Form(..., max_length=255)) -> IngestResponse:
    settings = request.app.state.settings
    jobs: threading.BoundedSemaphore = request.app.state.jobs
    if not jobs.acquire(blocking=False):
        raise EngineError("busy", "The data engine is busy with other files. Try again in a minute.", 503)
    started = time.perf_counter()
    directory = storage.dataset_dir(settings.data_dir, workspace_id, dataset_id)
    try:
        file_format = detect_format(filename)
        if directory.exists():
            raise EngineError("already_exists", "This dataset was already uploaded.", 409)
        directory.mkdir(parents=True)
        original = storage.original_path(directory, file_format)
        size = _save_upload(file, original, settings.max_upload_bytes)
        result = read_dataset(original, file_format, settings.max_rows, settings.max_columns)
        typed_df, profile = profile_dataframe(result.df)
        storage.write_canonical(directory, typed_df)
        log(logging.INFO, "dataset.ingested", workspace_id=workspace_id, dataset_id=dataset_id, format=file_format,
            size_bytes=size, rows=profile["row_count"], columns=profile["column_count"],
            quality=profile["quality"]["score"], ms=int((time.perf_counter() - started) * 1000))
        return IngestResponse(dataset_id=str(dataset_id), file_format=file_format, size_bytes=size,
                              read_notes=result.notes, encoding=result.encoding, delimiter=result.delimiter,
                              sheet=result.sheet, engine_version=ENGINE_VERSION, profile=profile)
    except EngineError as exc:
        if exc.code != "already_exists":
            shutil.rmtree(directory, ignore_errors=True)
        log(logging.INFO, "dataset.rejected", workspace_id=workspace_id, dataset_id=dataset_id, code=exc.code)
        raise
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    finally:
        jobs.release()
        file.file.close()


_frames: "OrderedDict[tuple[str, str], object]" = OrderedDict()
_frames_lock = threading.Lock()
FRAME_CACHE_SIZE = 4


def _load_frame(settings, workspace_id: UUID, dataset_id: UUID):
    """Small LRU cache: follow-up questions on the same dataset skip re-reading the file."""
    key = (str(workspace_id), str(dataset_id))
    with _frames_lock:
        if key in _frames:
            _frames.move_to_end(key)
            return _frames[key]
    try:
        df = storage.read_canonical(settings.data_dir, workspace_id, dataset_id)
    except FileNotFoundError as exc:
        raise EngineError("dataset_missing", "This dataset's file wasn't found. Upload it again.", 404) from exc
    with _frames_lock:
        _frames[key] = df
        while len(_frames) > FRAME_CACHE_SIZE:
            _frames.popitem(last=False)
    return df


def _forget_frame(workspace_id: UUID, dataset_id: UUID) -> None:
    with _frames_lock:
        _frames.pop((str(workspace_id), str(dataset_id)), None)


@app.post("/v1/workspaces/{workspace_id}/datasets/{dataset_id}/analyze", dependencies=[Depends(require_engine_key)])
def analyze(request: Request, workspace_id: UUID, dataset_id: UUID, body: AnalyzeRequest) -> dict:
    started = time.perf_counter()
    df = _load_frame(request.app.state.settings, workspace_id, dataset_id)
    result = run_analysis(df, body.spec, body.columns)
    result["duration_ms"] = int((time.perf_counter() - started) * 1000)
    log(logging.INFO, "dataset.analyzed", workspace_id=workspace_id, dataset_id=dataset_id, type=body.spec.type,
        rows=result.get("rows_considered"), ms=result["duration_ms"])
    return result


@app.delete("/v1/workspaces/{workspace_id}/datasets/{dataset_id}", response_model=DeleteResponse,
            dependencies=[Depends(require_engine_key)])
def delete(request: Request, workspace_id: UUID, dataset_id: UUID) -> DeleteResponse:
    _forget_frame(workspace_id, dataset_id)
    deleted = storage.delete_dataset(request.app.state.settings.data_dir, workspace_id, dataset_id)
    log(logging.INFO, "dataset.deleted", workspace_id=workspace_id, dataset_id=dataset_id, existed=deleted)
    return DeleteResponse(deleted=deleted)
