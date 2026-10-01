# Data engine (Phase 2)

A Python FastAPI service (`services/data-engine`) that owns dataset files and does every
calculation. The web app never parses uploaded files and the AI layer (Phase 3) will never
compute numbers itself: both ask the engine.

## Upload flow

```
Browser ──multipart──▶ Next.js /api/datasets
                         1. session + workspace + role check (member or above)
                         2. extension and size check
                         3. insert datasets row (status: processing)
                         4. forward file ──▶ Engine POST /v1/workspaces/{ws}/datasets/{id}/ingest
                                               a. stream to disk, stop past size limit
                                               b. signature check (magic bytes, zip bomb, macros)
                                               c. parse (CSV / XLSX / JSON / Parquet)
                                               d. infer types, convert text to numbers/dates
                                               e. profile, roles, quality score
                                               f. save typed copy as data.parquet
                         5. save profile + columns, status: ready (or failed + reason)
```

Files are stored at `<ENGINE_DATA_DIR>/<workspace_id>/<dataset_id>/`:
`original.<ext>` (untouched upload) and `data.parquet` (typed copy used by all analyses).
Paths are built only from UUIDs; the user's filename is never used on disk.

## Reading files

| Format | Details |
| --- | --- |
| CSV | Delimiter detected (comma, semicolon, tab, pipe). UTF-8, with Windows-1252 fallback for Excel exports. Malformed rows are reported by line number. |
| XLSX | First sheet is read; other sheet names are listed. Formulas are not evaluated (cached values only). Macro-enabled workbooks and zip bombs are rejected. Older .xls is not supported. |
| JSON | Array of records, `{"data": [...]}` wrappers, column-oriented objects, or JSON Lines. Nested objects are flattened one level (`customer.name`). |
| Parquet | Read as-is. |

Fully empty rows and columns are dropped; blank headers become `column_N`; duplicate
headers get a suffix. Every adjustment is listed under "How the file was read".

## Type inference

A text column is converted only when nearly all non-empty values agree:

| Detected as | Rule | Examples |
| --- | --- | --- |
| Number | ≥ 95% parse as numbers | `$1,204.50`, `(15.00)` → -15, `12%` → 0.12, `1.234,50` → 1234.5 |
| Date | ≥ 90% look like and parse as dates | `2026-03-01`, `Mar 4, 2026`, `31/01/2026` (day-first detected) |
| Yes/no | Only true/false, yes/no, y/n | `Yes`, `no` |
| ID | Name ends in id/code/sku/number, or ≥ 95% unique short values | `customer_id`, `ORD-0001` |
| Category | Few distinct values | regions, statuses |
| Text | Everything else | notes, descriptions |

Values that don't fit (e.g. "call for price" in a price column) become empty and are
counted as unreadable, which lowers the quality score and appears as a warning.

## Semantic roles

Names propose a role; data must confirm it. Rejected suggestions are kept with the reason.

| Role | Requires |
| --- | --- |
| time | Values are dates |
| monetary (revenue, price, cost, profit, amount, discount) | Numeric; mostly non-negative except profit, amount, discount. Currency symbols alone are enough for "amount". |
| quantity | Numeric whole numbers, none negative |
| identifier (customer, product, order, employee) | ID type; repeating values are fine |
| geographic | Category type with a place-like name |
| category / metric / flag / text | Fallbacks by type |

## Quality score

See `app/profiling/quality.py`. 100 minus capped penalties for sparse columns, missing
cells, duplicates, unreadable values, constant columns, and outliers (1.5×IQR). Each
penalty is shown with its cause.

## Statistics

Numbers: mean, median, std, min, max, sum, 5th/25th/75th/95th percentiles, zeros,
negatives, outliers with bounds. Dates: range, distinct dates, granularity (daily, weekly,
monthly…). Categories: top 5 values with shares. Relationships: Spearman rank correlation
≥ 0.7 between numeric columns, with Pearson alongside. Spearman is used so a single extreme
value can't hide or fake a relationship.

## API

All endpoints except `/health` require the `X-Engine-Key` header (shared secret).

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/workspaces/{ws}/datasets/{id}/ingest` | multipart `file` + `filename`; returns profile |
| DELETE | `/v1/workspaces/{ws}/datasets/{id}` | delete stored files |
| GET | `/health` | liveness |

Errors use `{"detail": {"code": "...", "message": "..."}}`. Messages for 4xx and 503 are
written for end users; 5xx details are logged only.

## Limits (environment variables)

| Variable | Default |
| --- | --- |
| `ENGINE_API_KEY` | required, ≥ 16 characters |
| `ENGINE_MAX_UPLOAD_MB` | 50 |
| `ENGINE_MAX_ROWS` | 2,000,000 |
| `ENGINE_MAX_COLUMNS` | 500 |
| `ENGINE_MAX_CONCURRENT_JOBS` | 2 (extra requests get a "busy" message) |
| `ENGINE_DATA_DIR` | `/data` in Docker |

Measured: a 125,000-row, 8-column CSV (6.6 MB) is read and profiled in about 2 seconds.

## Tests

```powershell
cd services/data-engine
py -3.12 -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest
```
