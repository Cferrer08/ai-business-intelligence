import io
import uuid

import pandas as pd
import pytest
from fastapi.testclient import TestClient

KEY = "test-key-0123456789"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ENGINE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ENGINE_MAX_UPLOAD_MB", "1")
    from app.main import app
    with TestClient(app) as c:
        c.data_dir = tmp_path
        yield c


def upload(client, ws, ds, content: bytes, name="sales.csv", key=KEY):
    return client.post(f"/v1/workspaces/{ws}/datasets/{ds}/ingest",
                       headers={"X-Engine-Key": key} if key else {},
                       files={"file": (name, io.BytesIO(content))}, data={"filename": name})


CSV = b"date,region,revenue\n2026-01-01,North,$100.00\n2026-01-02,South,$250.50\n2026-01-03,North,$80.00\n"


def test_requires_key(client):
    ws, ds = uuid.uuid4(), uuid.uuid4()
    assert upload(client, ws, ds, CSV, key=None).status_code == 401
    assert upload(client, ws, ds, CSV, key="wrong-key-000000000").status_code == 401


def test_ingest_stores_typed_canonical_copy(client):
    ws, ds = uuid.uuid4(), uuid.uuid4()
    r = upload(client, ws, ds, CSV)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["profile"]["row_count"] == 3
    stored = pd.read_parquet(client.data_dir / str(ws) / str(ds) / "data.parquet")
    assert str(stored["date"].dtype).startswith("datetime64")
    assert stored["revenue"].sum() == pytest.approx(430.5)
    assert (client.data_dir / str(ws) / str(ds) / "original.csv").exists()


def test_rejects_non_uuid_ids(client):
    r = client.post("/v1/workspaces/../datasets/x/ingest", headers={"X-Engine-Key": KEY},
                    files={"file": ("a.csv", io.BytesIO(CSV))}, data={"filename": "a.csv"})
    assert r.status_code in (404, 422)


def test_too_large_is_rejected_and_cleaned_up(client):
    ws, ds = uuid.uuid4(), uuid.uuid4()
    big = b"a\n" + b"1\n" * 600_000  # > 1 MB test limit
    r = upload(client, ws, ds, big)
    assert r.status_code == 413
    assert r.json()["detail"]["code"] == "file_too_large"
    assert not (client.data_dir / str(ws) / str(ds)).exists()


def test_invalid_file_message_is_user_safe(client):
    r = upload(client, uuid.uuid4(), uuid.uuid4(), b"not excel", name="x.xlsx")
    assert r.status_code == 422
    assert "Excel" in r.json()["detail"]["message"]


def test_duplicate_ingest_conflicts(client):
    ws, ds = uuid.uuid4(), uuid.uuid4()
    assert upload(client, ws, ds, CSV).status_code == 200
    r = upload(client, ws, ds, CSV)
    assert r.status_code == 409
    assert (client.data_dir / str(ws) / str(ds) / "data.parquet").exists()  # original kept


def test_delete_is_scoped_to_workspace(client):
    ws_a, ws_b, ds = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    assert upload(client, ws_a, ds, CSV).status_code == 200
    # Another workspace using the same dataset id cannot touch A's files.
    r = client.delete(f"/v1/workspaces/{ws_b}/datasets/{ds}", headers={"X-Engine-Key": KEY})
    assert r.json() == {"deleted": False}
    assert (client.data_dir / str(ws_a) / str(ds)).exists()
    r = client.delete(f"/v1/workspaces/{ws_a}/datasets/{ds}", headers={"X-Engine-Key": KEY})
    assert r.json() == {"deleted": True}


def test_health_needs_no_key(client):
    assert client.get("/health").json()["status"] == "ok"
