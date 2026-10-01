"""Validate an uploaded file and read it into a DataFrame.

Every upload is untrusted. Checks run before any parser sees the bytes:
extension allow-list, size limit, content signature (magic bytes), and for XLSX a
zip-bomb and macro check. Parsers never evaluate formulas or execute anything.
"""
from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from .errors import InvalidFile, LimitExceeded

SUPPORTED = {"csv", "xlsx", "json", "parquet"}
TEXT_SAMPLE_BYTES = 64 * 1024
MAX_XLSX_UNCOMPRESSED = 500 * 1024 * 1024
MAX_XLSX_RATIO = 100


@dataclass
class ReadResult:
    df: pd.DataFrame
    file_format: str
    notes: list[str] = field(default_factory=list)  # facts about how the file was read
    encoding: str | None = None
    delimiter: str | None = None
    sheet: str | None = None


def detect_format(filename: str) -> str:
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext == "jsonl":
        ext = "json"
    if ext not in SUPPORTED:
        raise InvalidFile("unsupported_format", "Upload a CSV, Excel (.xlsx), JSON or Parquet file.")
    return ext


def check_signature(path: Path, file_format: str) -> None:
    size = path.stat().st_size
    if size == 0:
        raise InvalidFile("empty_file", "The file is empty.")
    with path.open("rb") as fh:
        head = fh.read(TEXT_SAMPLE_BYTES)
        if file_format == "parquet":
            fh.seek(max(0, size - 4))
            tail = fh.read(4)
    if file_format == "xlsx":
        if not head.startswith(b"PK\x03\x04"):
            raise InvalidFile("bad_signature", "This doesn't look like an Excel .xlsx file. If it's an older .xls file, save it as .xlsx first.")
    elif file_format == "parquet":
        if not (head.startswith(b"PAR1") and tail == b"PAR1"):
            raise InvalidFile("bad_signature", "This doesn't look like a valid Parquet file.")
    else:
        if b"\x00" in head:
            raise InvalidFile("binary_content", f"This file contains binary data, so it can't be read as {file_format.upper()}.")


def _check_xlsx_archive(path: Path) -> None:
    try:
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
            if "xl/workbook.xml" not in names:
                raise InvalidFile("bad_signature", "This file isn't a valid Excel workbook.")
            if any(n.lower().endswith("vbaproject.bin") for n in names):
                raise InvalidFile("macros_not_allowed", "Workbooks with macros aren't accepted. Save a copy as a regular .xlsx file.")
            total = sum(i.file_size for i in zf.infolist())
            compressed = max(1, sum(i.compress_size for i in zf.infolist()))
            if total > MAX_XLSX_UNCOMPRESSED or total / compressed > MAX_XLSX_RATIO:
                raise LimitExceeded("too_large_uncompressed", "This workbook expands to more data than we can process. Export the sheet you need as CSV.")
    except zipfile.BadZipFile as exc:
        raise InvalidFile("bad_signature", "This Excel file is damaged or incomplete.") from exc


def _decode_sample(raw: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise InvalidFile("bad_encoding", "The file's text encoding isn't supported. Save it as UTF-8 and upload again.")


def _sniff_delimiter(sample: str) -> str:
    # Cut at the last newline so a half-read final line doesn't confuse the sniffer.
    cut = sample[: sample.rfind("\n")] if "\n" in sample else sample
    try:
        return csv.Sniffer().sniff(cut, delimiters=",;\t|").delimiter
    except csv.Error:
        return ","


def _read_csv(path: Path) -> ReadResult:
    with path.open("rb") as fh:
        raw = fh.read(TEXT_SAMPLE_BYTES)
    _, encoding = _decode_sample(raw)
    # A full UTF-8 check: a sample can be valid while a later byte isn't.
    if encoding == "utf-8-sig":
        try:
            path.read_bytes().decode("utf-8-sig")
        except UnicodeDecodeError:
            encoding = "cp1252"
    sample = raw.decode(encoding, errors="replace")
    delimiter = _sniff_delimiter(sample)
    try:
        df = pd.read_csv(path, sep=delimiter, encoding=encoding, low_memory=False, skipinitialspace=True)
    except pd.errors.EmptyDataError as exc:
        raise InvalidFile("empty_file", "The file has no rows.") from exc
    except pd.errors.ParserError as exc:
        match = re.search(r"Expected (\d+) fields in line (\d+), saw (\d+)", str(exc))
        if match:
            exp, line, saw = match.groups()
            raise InvalidFile("malformed_csv", f"Line {line} has {saw} values but the header has {exp}. Check for unquoted commas in that row.") from exc
        raise InvalidFile("malformed_csv", "The CSV couldn't be read. Check that every row has the same number of columns.") from exc
    notes = []
    names = {",": "commas", ";": "semicolons", "\t": "tabs", "|": "pipes"}
    if delimiter != ",":
        notes.append(f"Columns are separated by {names[delimiter]}.")
    if encoding == "cp1252":
        notes.append("Read with Windows-1252 text encoding.")
    return ReadResult(df=df, file_format="csv", notes=notes, encoding=encoding, delimiter=delimiter)


def _read_xlsx(path: Path) -> ReadResult:
    _check_xlsx_archive(path)
    try:
        # openpyxl reads cached cell values; formulas are never evaluated.
        book = pd.ExcelFile(path, engine="openpyxl")
        sheets = book.sheet_names
        df = book.parse(sheets[0])
    except InvalidFile:
        raise
    except Exception as exc:  # openpyxl raises many types for damaged files
        raise InvalidFile("unreadable_xlsx", "This Excel file couldn't be read. Try opening and re-saving it in Excel.") from exc
    notes = []
    if len(sheets) > 1:
        notes.append(f"Read the first sheet, \u201c{sheets[0]}\u201d. Other sheets: {', '.join(sheets[1:6])}{'…' if len(sheets) > 6 else ''}.")
    return ReadResult(df=df, file_format="xlsx", notes=notes, sheet=sheets[0])


def _records_from_json(obj: object) -> list | None:
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        lists = [v for v in obj.values() if isinstance(v, list)]
        # {"data": [ {...}, ... ]} wrapper
        if len(obj) <= 3 and len(lists) == 1 and lists[0] and isinstance(lists[0][0], dict):
            return lists[0]
        # column-oriented {"a": [..], "b": [..]}
        if obj and all(isinstance(v, list) for v in obj.values()):
            lengths = {len(v) for v in obj.values()}
            if len(lengths) == 1:
                return [dict(zip(obj.keys(), row)) for row in zip(*obj.values())]
    return None


def _read_json(path: Path) -> ReadResult:
    text = path.read_bytes().decode("utf-8-sig", errors="strict")
    notes: list[str] = []
    records = None
    try:
        records = _records_from_json(json.loads(text))
    except json.JSONDecodeError:
        lines = [ln for ln in text.splitlines() if ln.strip()]
        try:
            records = [json.loads(ln) for ln in lines]
            notes.append("Read as JSON Lines (one record per line).")
        except json.JSONDecodeError as exc:
            raise InvalidFile("malformed_json", "The JSON couldn't be parsed. Upload an array of records or one record per line.") from exc
    if not records or not all(isinstance(r, dict) for r in records):
        raise InvalidFile("unsupported_json_shape", "Upload JSON as a list of records, like [{\"date\": \"…\", \"revenue\": 120}, …].")
    df = pd.json_normalize(records, max_level=1)
    if any("." in c for c in df.columns):
        notes.append("Nested fields were flattened into columns such as \u201cparent.child\u201d.")
    return ReadResult(df=df, file_format="json", notes=notes, encoding="utf-8")


def _read_parquet(path: Path) -> ReadResult:
    try:
        return ReadResult(df=pq.read_table(path).to_pandas(), file_format="parquet")
    except Exception as exc:
        raise InvalidFile("unreadable_parquet", "This Parquet file couldn't be read.") from exc


READERS = {"csv": _read_csv, "xlsx": _read_xlsx, "json": _read_json, "parquet": _read_parquet}


def clean_column_names(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    notes = []
    names: list[str] = []
    seen: dict[str, int] = {}
    renamed_blank = 0
    for i, col in enumerate(df.columns):
        name = str(col).strip()
        if not name or name.lower().startswith("unnamed:"):
            name = f"column_{i + 1}"
            renamed_blank += 1
        base = name
        if name in seen:
            seen[base] += 1
            name = f"{base}_{seen[base]}"
        else:
            seen[name] = 1
        names.append(name[:120])
    if renamed_blank:
        notes.append(f"{renamed_blank} column{'s' if renamed_blank > 1 else ''} had no header and {'were' if renamed_blank > 1 else 'was'} named by position.")
    out = df.copy()
    out.columns = names
    return out, notes


def read_dataset(path: Path, file_format: str, max_rows: int, max_columns: int) -> ReadResult:
    check_signature(path, file_format)
    try:
        result = READERS[file_format](path)
    except UnicodeDecodeError as exc:
        raise InvalidFile("bad_encoding", "The file's text encoding isn't supported. Save it as UTF-8 and upload again.") from exc
    df = result.df
    # Drop rows and columns that are completely empty (common in spreadsheets).
    before_rows, before_cols = df.shape
    df = df.dropna(how="all").dropna(axis=1, how="all")
    if df.shape[0] < before_rows:
        result.notes.append(f"Ignored {before_rows - df.shape[0]:,} completely empty rows.")
    if df.shape[1] < before_cols:
        result.notes.append(f"Ignored {before_cols - df.shape[1]} completely empty columns.")
    if df.empty or df.shape[1] == 0:
        raise InvalidFile("no_data", "The file has no data rows.")
    if df.shape[0] > max_rows:
        raise LimitExceeded("too_many_rows", f"The file has {df.shape[0]:,} rows. The limit is {max_rows:,}.")
    if df.shape[1] > max_columns:
        raise LimitExceeded("too_many_columns", f"The file has {df.shape[1]:,} columns. The limit is {max_columns:,}.")
    df, notes = clean_column_names(df.reset_index(drop=True))
    result.df = df
    result.notes.extend(notes)
    return result
