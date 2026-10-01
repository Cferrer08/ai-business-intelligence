# Build phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: app, database, auth, workspaces, dashboard | **Done, verified** |
| 2 | Data engine: upload, storage, Pandas profiling, quality score | **Done, verified** |
| 3 | AI analyst: planning, tool calling, conversation history | **Done, verified with a stand-in model** |
| 4 | Visualization | Next |
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

## Phase 2 verification

- Engine: 36 pytest tests (type conversion, roles, quality score, every file format,
  malformed/binary/macro/zip-bomb files, limits, API auth, workspace-scoped deletion)
- Web: 16 unit tests; type check; clean production build
- `apps/web/e2e/phase2_e2e.py` with the real engine and PostgreSQL: all checks pass,
  including a forged cross-workspace delete and an engine outage. Phase 1 suite re-run: passes.
- Performance: 125,000 rows × 8 columns profiled in about 2 seconds

### Issues found and fixed during verification
1. Customer and product ids that repeat across rows were classified as free text. Id-named
   columns are now identifiers regardless of repetition.
2. A single extreme value hid a real relationship from Pearson correlation. Detection now
   uses Spearman rank correlation, with Pearson reported alongside.
3. An optional, mostly-empty Notes column cut the quality score by 28 points and was
   penalised twice. Sparse columns now get one small, labelled penalty.
4. Unique order numbers were summarised as "ORD-0000 (1%)". Mostly-unique columns now
   show examples instead of frequencies.

## Phase 3 verification

- Engine: 47 tests; every analysis result is checked against an independent pandas
  calculation (contributions to a change sum to exactly 100%)
- AI package: 17 tests with a scripted model: grounding, plan repair, engine-error repair,
  template fallback, AI outages, clarifications
- Web: 16 unit tests, type check, clean production build
- `phase3_e2e.py` (real engine and PostgreSQL, stand-in model over HTTP): trend, follow-up
  filter, period comparison with contributors, unsupported request, typo repair, rejected
  invented number, saved history, usage rows, cross-workspace access refused. Phase 1 and
  2 suites re-run: pass.
- **Not verified here: the real OpenAI model.** Run `npm run eval -w @insight/ai` with your
  key for plan accuracy, numerical accuracy and grounding rate.

### Issues found and fixed during verification
1. Headline and table rounded the same value differently (4,892 vs 4,892.5) and percents
   differently (8.0% vs -8%). Engine facts and tables now share one formatting rule.
2. A region falling more than the total showed "175% of the change" with no explanation.
   The engine now adds a note when shares exceed 100%.
