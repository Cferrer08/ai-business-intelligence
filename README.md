# InsightAI — AI Business Intelligence Analyst

Upload business data, ask questions in plain English, and get answers calculated by a Python
data engine and explained by an AI analyst.

The product is built in phases. **This repository is at the end of Phase 1 (Foundation).**
See [`docs/PHASES.md`](docs/PHASES.md) for what is done and what comes next.

## Phase 1 includes

- Next.js 15 + React 19 + TypeScript + Tailwind app (`apps/web`)
- PostgreSQL schema and migrations with Drizzle ORM (`packages/database`)
- Email/password accounts with database-backed sessions
- Workspaces with roles (owner, admin, member, viewer) and tenant-scoped access
- Dashboard, settings, onboarding, landing page
- Audit log, structured logging, `/api/health`
- Unit tests (Vitest) and an end-to-end suite (Playwright)

Nothing in the app shows sample data as if it were real. Sections from later phases say so.

## Local setup

Requirements: Node 20+, Docker (or any PostgreSQL 16).

```bash
# 1. Database
docker compose -f infrastructure/docker-compose.yml up -d

# 2. Environment
cp .env.example apps/web/.env.local          # app
cp .env.example packages/database/.env       # migrations (only DATABASE_URL is read)

# 3. Install and migrate
npm install
DATABASE_URL=postgresql://insight:insight@localhost:5432/insight_ai npm run db:migrate

# 4. Run
npm run dev                                   # http://localhost:3000
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the web app in development |
| `npm run build` | Production build of the web app |
| `npm run typecheck` | Type-check every workspace package |
| `npm test` | Unit tests |
| `npm run db:generate` | Create a new SQL migration after editing `packages/database/src/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |

## End-to-end tests

Run against a production build and an **empty** database:

```bash
npm run build && npm start -w @insight/web
pip install playwright && playwright install chromium
E2E_BASE_URL=http://localhost:3000 python apps/web/e2e/phase1_e2e.py
```

The suite covers sign-up validation, onboarding, rename, sign-out, revoked sessions,
duplicate accounts, and a second user trying to switch into the first user's workspace
with a forged id.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/PHASES.md`](docs/PHASES.md)
