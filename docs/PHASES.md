# Build phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: app, database, auth, workspaces, dashboard | **Done, verified** |
| 2 | Data engine: upload, storage, Pandas profiling, quality score | Next |
| 3 | AI analyst: planning, tool calling, conversation history | Planned |
| 4 | Visualization | Planned |
| 5 | Anomalies, forecasting, correlation, segmentation | Planned |
| 6 | RAG knowledge base (Pinecone) | Planned |
| 7 | Reports and PDF export | Planned |
| 8 | Workflows and daily briefing | Planned |
| 9 | Stripe billing and usage limits | Planned |
| 10 | Production hardening, monitoring, deployment | Planned |

## Phase 1 verification

- `npm run typecheck`: passes in every package
- `npm test`: 11 unit tests pass (passwords, tokens, rate limiter, validation, slugs, roles)
- `next build`: clean production build
- `apps/web/e2e/phase1_e2e.py` against a production build and real PostgreSQL: all checks pass

### Bugs found and fixed during verification
1. React 19 resets forms after an action, which erased the user's input on a validation
   error. Non-secret fields are now echoed back and refilled.
2. In production, sign-out didn't clear the `__Host-` cookie (attributes didn't match), and
   the middleware bounced any cookie-holder from `/login` to `/dashboard`, causing a redirect
   loop. Cookie set/clear now share one attribute definition, and only a real session check
   redirects away from `/login`. Revoked sessions return users to the page they asked for.
