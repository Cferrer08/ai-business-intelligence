import io
import json
import zipfile

import pandas as pd
import pytest

from app.errors import InvalidFile, LimitExceeded
from app.ingest import detect_format, read_dataset


def write(tmp_path, name, data: bytes):
    p = tmp_path / name
    p.write_bytes(data)
    return p


def read(path, fmt, max_rows=1_000_000, max_cols=500):
    return read_dataset(path, fmt, max_rows, max_cols)


def test_unsupported_extension():
    with pytest.raises(InvalidFile):
        detect_format("report.pdf")
    assert detect_format("Sales.CSV") == "csv"
    assert detect_format("events.jsonl") == "json"


def test_semicolon_csv_and_windows_encoding(tmp_path):
    text = "Región;Ventas\nNoreste;1.234,50\nSur;99,00\n"
    p = write(tmp_path, "a.csv", text.encode("cp1252"))
    r = read(p, "csv")
    assert list(r.df.columns) == ["Región", "Ventas"]
    assert r.delimiter == ";" and r.encoding == "cp1252"
    assert any("semicolons" in n for n in r.notes)


def test_malformed_csv_reports_line(tmp_path):
    p = write(tmp_path, "bad.csv", b"a,b\n1,2\n3,4,5\n")
    with pytest.raises(InvalidFile) as e:
        read(p, "csv")
    assert "Line 3" in e.value.message


def test_binary_content_rejected_as_csv(tmp_path):
    p = write(tmp_path, "x.csv", b"a,b\x00\x01\x02")
    with pytest.raises(InvalidFile):
        read(p, "csv")


def test_empty_file(tmp_path):
    with pytest.raises(InvalidFile):
        read(write(tmp_path, "e.csv", b""), "csv")


def test_csv_renamed_to_xlsx_is_rejected(tmp_path):
    with pytest.raises(InvalidFile) as e:
        read(write(tmp_path, "x.xlsx", b"a,b\n1,2\n"), "xlsx")
    assert e.value.code == "bad_signature"


def test_xlsx_reads_first_sheet_and_notes_others(tmp_path):
    p = tmp_path / "book.xlsx"
    with pd.ExcelWriter(p) as w:
        pd.DataFrame({"date": ["2026-01-01"], "sales": [10]}).to_excel(w, sheet_name="Sales", index=False)
        pd.DataFrame({"x": [1]}).to_excel(w, sheet_name="Notes", index=False)
    r = read(p, "xlsx")
    assert r.sheet == "Sales" and list(r.df.columns) == ["date", "sales"]
    assert any("Notes" in n for n in r.notes)


def test_xlsx_with_macros_rejected(tmp_path):
    p = tmp_path / "m.xlsx"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("xl/workbook.xml", "<workbook/>")
        z.writestr("xl/vbaProject.bin", b"macro")
    with pytest.raises(InvalidFile) as e:
        read(p, "xlsx")
    assert e.value.code == "macros_not_allowed"


def test_xlsx_zip_bomb_rejected(tmp_path):
    p = tmp_path / "bomb.xlsx"
    with zipfile.ZipFile(p, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("xl/workbook.xml", "<workbook/>")
        z.writestr("xl/worksheets/sheet1.xml", "0" * 50_000_000)
    with pytest.raises(LimitExceeded):
        read(p, "xlsx")


@pytest.mark.parametrize("payload", [
    [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}],
    {"data": [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]},
    {"a": [1, 2], "b": ["x", "y"]},
])
def test_json_shapes(tmp_path, payload):
    r = read(write(tmp_path, "d.json", json.dumps(payload).encode()), "json")
    assert r.df.shape == (2, 2)


def test_json_lines_and_nested(tmp_path):
    lines = b'{"id": 1, "customer": {"name": "Ana"}}\n{"id": 2, "customer": {"name": "Ben"}}\n'
    r = read(write(tmp_path, "d.json", lines), "json")
    assert "customer.name" in r.df.columns


def test_json_scalar_rejected(tmp_path):
    with pytest.raises(InvalidFile):
        read(write(tmp_path, "d.json", b'"hello"'), "json")


def test_parquet_roundtrip(tmp_path):
    p = tmp_path / "d.parquet"
    pd.DataFrame({"a": [1, 2, 3]}).to_parquet(p)
    assert read(p, "parquet").df["a"].sum() == 6


def test_limits(tmp_path):
    p = write(tmp_path, "big.csv", ("a\n" + "1\n" * 11).encode())
    with pytest.raises(LimitExceeded):
        read(p, "csv", max_rows=10)


def test_blank_headers_and_empty_rows(tmp_path):
    p = write(tmp_path, "s.csv", b"name,,score\nAna,x,1\n,,\nBen,y,2\n")
    r = read(p, "csv")
    assert list(r.df.columns) == ["name", "column_2", "score"]
    assert len(r.df) == 2
