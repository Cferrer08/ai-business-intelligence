# InsightAI — AI Business Intelligence Analyst

Upload business data, ask questions in plain English, and get answers calculated by a Python
data engine and explained by an AI analyst.

The product is built in phases. **This repository is at the end of Phase 7 (Business reports).**
See [`docs/PHASES.md`](docs/PHASES.md) for what is done and what comes next.

## What works today

**Phase 7: business reports**
- One click: executive summary, key figures, trends, what changed, products, regions,
  customers, anomalies, forecast, risks and recommended actions, with charts
- PDF export (rendered server-side), key figures as CSV, saved reports, revocable share links

**Phase 6: knowledge base**
- Upload PDFs, Word and text documents; search them by meaning on the Knowledge page
- The AI Analyst answers document questions with citations and adds a "From your
  documents" section to data answers, kept visibly separate from calculated numbers
- Instruction-like passages are flagged and never sent to the AI

**Phase 5: advanced analytics**
- Forecasts with 80%/95% ranges, using the simplest method that tests well on your history
- Anomalies: unusual days or months, unusual transactions, groups that changed unusually,
  each with the reason it was flagged
- Correlation, customer segments (RFM) and trend analysis
- Forecasts, Anomalies and Analytics pages, plus the same through the AI Analyst

**Phase 4: visualization**
- Every analysis gets a chart chosen from its calculated results: line, bar, diverging
  bar, histogram, scatter, pie (only where it fits) or number cards
- Switch chart type, show top 5/10, hide series, expand, download PNG/SVG/CSV, see the data
- Live dashboard: revenue, orders, customers and average order value for the latest complete
  month vs the month before, monthly trend, biggest changes, pinned charts, recent analyses

**Phase 3: AI analyst**
- Ask questions in plain English about a dataset; follow-up questions keep context
- The model plans the analysis, the Python engine calculates it, the model explains it
- Every number shown is calculated by the engine and highlighted; suggestions are labelled
- Conversations are saved; every model call is logged with tokens and estimated cost

**Phase 2: data engine**
- Upload CSV, Excel (.xlsx), JSON or Parquet files up to 50 MB
- Python FastAPI service that validates files, converts text to real numbers and dates,
  profiles every column, infers business roles (revenue, customer id, region…) and scores
  data quality with an itemised breakdown
- Data page and per-dataset profile page; delete datasets

**Phase 1: foundation**

- Next.js 15 + React 19 + TypeScript + Tailwind app (`apps/web`)
- PostgreSQL schema and migrations with Drizzle ORM (`packages/database`)
- Email/password accounts with database-backed sessions
- Workspaces with roles (owner, admin, member, viewer) and tenant-scoped access
- Dashboard, settings, onboarding, landing page
- Audit log, structured logging, `/api/health`
- Unit tests (Vitest) and an end-to-end suite (Playwright)

Nothing in the app shows sample data as if it were real. Sections from later phases say so.

## Updating to a new version

After copying in a new version, always run these three, in order:

```powershell
docker compose -f infrastructure/docker-compose.yml up -d --build
npm install
npm run db:migrate
```

If you forget the last one, the app shows a "database needs updating" page instead of errors.

## Local setup (Windows / PowerShell)

Requirements: **Node 20.12+**, **Docker Desktop** (runs PostgreSQL and the data engine), and
Python 3.12 only if you run the Python or end-to-end tests outside Docker.

```powershell
# 1. Start PostgreSQL and the data engine (Docker Desktop must be running).
#    --build is needed the first time and whenever services/data-engine changes.
docker compose -f infrastructure/docker-compose.yml up -d --build

# 2. Environment files. The defaults already match the docker-compose database.
Copy-Item .env.example apps/web/.env.local
Copy-Item .env.example packages/database/.env

# 3. Install and create the tables
npm install
npm run db:migrate

# 4. Run
npm run dev        # http://localhost:3000
```

For the Knowledge base, create a Pinecone serverless index (dimension 1536, metric cosine)
and set `PINECONE_API_KEY` and `PINECONE_INDEX` in `apps/web/.env.local`. See
`docs/KNOWLEDGE.md`.

For the AI Analyst, add your OpenAI key to `apps/web/.env.local` (`OPENAI_API_KEY=sk-...`),
check `OPENAI_MODEL` and its two price lines, and restart `npm run dev`. Without a key,
everything else works and the AI Analyst page explains what's missing.

`apps/web/.env.local` must contain `FASTAPI_URL` and an `ENGINE_API_KEY` that matches the
engine container (the defaults in `.env.example` match `docker-compose.yml`). If you copied
`.env.example` before Phase 2, add those two lines.

Migrations read `packages/database/.env` themselves, so no environment variables need to
be set in the shell. A `DATABASE_URL` already set in the shell takes precedence.

### Troubleshooting on Windows

- **"npm.ps1 cannot be loaded because running scripts is disabled"**: run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then reopen PowerShell.
- **`docker` not found or "cannot connect to the Docker daemon"**: start Docker Desktop
  and wait until it reports that the engine is running.
- **Port 5432 already in use**: a local PostgreSQL install is running. Stop it from
  Services, or change the left side of `"5432:5432"` in `infrastructure/docker-compose.yml`
  (for example `"5433:5432"`) and update `DATABASE_URL` in both `.env` files to match.
- **Check the app can reach the database**: open http://localhost:3000/api/health; it
  should report `"database":"ok"`.
- **Check the data engine**: open http://127.0.0.1:8000/health; it should report
  `"status":"ok"`. Engine logs: `docker compose -f infrastructure/docker-compose.yml logs data-engine`.
- **AI Analyst says the API key was rejected**: check `OPENAI_API_KEY` and that billing is
  enabled on your OpenAI account. "Busy or usage limit" means OpenAI rate-limited the key.
- **Uploads say the data engine isn't reachable**: the engine container isn't running, or
  `FASTAPI_URL` is wrong. If the engine log shows 401 responses, `ENGINE_API_KEY` differs
  between `apps/web/.env.local` and the container.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the web app in development |
| `npm run build` | Production build of the web app |
| `npm run typecheck` | Type-check every workspace package |
| `npm test` | Web unit tests (engine tests: see `docs/DATA_ENGINE.md`) |
| `npm run db:generate` | Create a new SQL migration after editing `packages/database/src/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |

## End-to-end tests

Run against a production build and an **empty** database. In one PowerShell window:

```powershell
npm run build
npm start -w @insight/web
```

In a second window:

```powershell
pip install playwright "psycopg[binary]"
playwright install chromium
$env:E2E_BASE_URL = "http://localhost:3000"
python apps/web/e2e/phase1_e2e.py
pip install pandas openpyxl
python apps/web/e2e/phase2_e2e.py
```

Phase 3's suite uses a stand-in model so it's free and repeatable. Start the stand-in in a
third window with `python apps/web/e2e/fake_openai.py 8765`, run the app with
`OPENAI_API_KEY=test-openai-key` and `OPENAI_BASE_URL=http://127.0.0.1:8765/v1`, then run
`python apps/web/e2e/phase3_e2e.py`, then `phase4_e2e.py` and `phase5_e2e.py` with the same
setup. For `phase6_e2e.py` also start `python apps/web/e2e/fake_pinecone.py 8766` and run the
app with `PINECONE_API_KEY=test-pinecone-key`, `PINECONE_INDEX=insight`,
`PINECONE_CONTROL_URL=http://127.0.0.1:8766` and `RAG_MIN_SCORE=0.1`. `phase7_e2e.py` uses the
same setup as Phase 3. To score the real model, see `docs/AI_ARCHITECTURE.md`.

To empty the database before a rerun:

```powershell
docker compose -f infrastructure/docker-compose.yml exec postgres psql -U insight -d insight_ai -c "truncate users, workspaces, workspace_members, sessions, audit_logs, datasets, dataset_columns, dataset_profiles, conversations, messages, analysis_requests, analysis_results, ai_requests, charts, forecasts, anomalies, analytics_runs, documents, document_chunks, reports cascade"
```

Phase 1 covers sign-up validation, onboarding, rename, sign-out, revoked sessions,
duplicate accounts, and a second user trying to switch into the first user's workspace
with a forged id. Phase 2 uploads a messy sales CSV and an Excel workbook, checks the
profile against known values, rejects a disguised binary file, and verifies that another
workspace can neither open nor delete the dataset. Screenshots go to `e2e-shots/`.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DATA_ENGINE.md`](docs/DATA_ENGINE.md)
- [`docs/AI_ARCHITECTURE.md`](docs/AI_ARCHITECTURE.md)
- [`docs/VISUALIZATION.md`](docs/VISUALIZATION.md)
- [`docs/ANALYTICS.md`](docs/ANALYTICS.md)
- [`docs/KNOWLEDGE.md`](docs/KNOWLEDGE.md)
- [`docs/REPORTS.md`](docs/REPORTS.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/PHASES.md`](docs/PHASES.md)
