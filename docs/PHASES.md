# Build phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: app, database, auth, workspaces, dashboard | **Done, verified** |
| 2 | Data engine: upload, storage, Pandas profiling, quality score | **Done, verified** |
| 3 | AI analyst: planning, tool calling, conversation history | **Done, verified with a stand-in model** |
| 4 | Visualization | **Done, verified** |
| 5 | Anomalies, forecasting, correlation, segmentation | **Done, verified** |
| 6 | RAG knowledge base (Pinecone) | **Done, verified with stand-ins** |
| 7 | Reports and PDF export | **Done, verified** |
| 8 | Workflows and daily briefing | **Done, verified** |
| 9 | Stripe billing and usage limits | Next |
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

## Phase 4 verification

- Engine: 51 tests, including distribution bins and dashboard KPIs checked against pandas
- AI package: 18 tests (distribution plans, chart preference stripped before the engine)
- Web: 24 unit tests, including chart selection rules and CSV export safety
- `phase4_e2e.py`: line/bar/table switching, a refused pie for a time series, pie by region,
  CSV export equal to pandas totals, valid SVG and PNG files, expand dialog, scatter with
  one point per customer, top-5 filter, histogram bars, diverging colours, dashboard KPIs
  equal to pandas for the latest complete month, pin and unpin, migrations reported current,
  another workspace sees none of it. Phase 1–3 suites re-run: pass.

### Also in this version
- `localhost` in `DATABASE_URL` now works on Windows (rewritten to 127.0.0.1).
- Pending migrations show a "database needs updating" page and a 503 from `/api/health`
  instead of query errors.

### Issues found and fixed during verification
1. The dashboard trend ended with a partial month that looked like a drop. Partial months
   are now flagged by the engine and labelled.
2. Exact numbers were only reachable through hover tooltips. Every chart now has a
   "Show data" table.
3. Tiny scatter previews showed unreadable axis ticks; previews now hide axes.

## Phase 5 verification

- Engine: 67 tests, with planted answers (spike and drop in a weekday pattern, a collapsing
  region inside seasonal data, a huge order, customers built as Champions / At risk, a real
  relationship next to noise) and forecasts checked against months they never saw
- Forecast calibration measured on 360 simulated series (see `ANALYTICS.md`)
- AI package: 20 tests; web: 27 tests; type check; clean build
- `phase5_e2e.py`: forecast with ranges and the "too little history" refusal, unusual days
  (exactly the two planted events), the collapsing region (and only that one), the huge
  order by file row and order id, correlation, segments, a rising trend, the analyst
  answering all of these, and another workspace refused. Phase 1–4 suites re-run: pass.

### Issues found and fixed during verification
1. Monthly summary data (rows dated the 1st) lost its last, complete month, in forecasts and
   on the dashboard. Partial periods now require finer data that stops early.
2. A seasonal model was silently dropped when it couldn't fit the earliest backtest window;
   models are now compared on the windows they can all run.
3. Forecast ranges ignored bias and were too narrow; they now combine backtest RMSE and the
   model's own interval, with a seasonal-uncertainty widening (calibration table above).
4. The first anomaly method absorbed outliers into its own baseline and underestimated noise,
   hiding a $45,000 order and flagging ordinary days. Replaced with a neighbour baseline that
   never includes the period being judged.
5. Flags now also need a meaningful size (not just statistical rarity).
6. Group anomalies missed a 66% collapse inside seasonal data, then (with shares) flagged the
   healthy regions; groups are now judged against the typical group's movement.
7. The trend could say "falling, statistically clear" for growing data because the direction
   came from an outlier-sensitive line fit; it now uses the matching Theil–Sen slope.
8. Forms: an empty "All numeric columns" choice and a hidden field were rejected as invalid.
9. A flat forecast on 23 months of seasonal data now says why seasonality isn't modelled.

## Phase 6 verification

- Engine: 78 tests, including PDFs (text, scanned, password-protected, fake), Word headings
  and tables, macro rejection, injection flagging, control-character removal, chunk sizes
- AI package: 26 tests: cited document answers, invented numbers rejected, document notes
  beside calculations, search failure falling back to data-only answers
- `phase6_e2e.py` with stand-ins for OpenAI and Pinecone that speak their HTTP APIs: three
  documents indexed (one vector per passage in the workspace's namespace), scanned PDF
  refused, semantic search, a cited policy answer, a calculation with a separate policy
  note, the planted injection never reaching any prompt, deletion removing vectors and
  citations, another workspace finding nothing. Phase 1–5 suites re-run: pass.
- **Not verified here: real OpenAI embeddings and real Pinecone.** Set the keys and upload
  a document; `RAG_MIN_SCORE` may need tuning for your documents.

### Issues found and fixed during verification
1. Passage overlap copied an injected paragraph into the next passage, flagging (and
   excluding) legitimate text too. Flagged text is no longer carried over.
2. "What does our pricing policy say" missed the policy because the document's title
   wasn't embedded. Titles and headings are now embedded with each passage.
3. PDF headings ran into the next sentence. Short unpunctuated lines followed by a
   capitalised line are now treated as headings and label their passages.
4. The document answer card repeated "From your documents" as label and heading.

### Follow-up: extraction checked against realistic documents
A price list, two policies and a supplier-notes file were extracted and every passage read.
Found and fixed: PDF running footers inside passages, table rows run together, SKUs and
table headers taken as headings, wrapped lines scrambled (pypdf positions; switched layout
reading to pdfminer.six), prose with "$35" or "10%" treated as table rows, a table's first
label-only row merged into its header, passages ending on a heading, tables split across
passages losing their header row, and one injected sentence excluding a whole passage of
legitimate text. Engine tests: 81.

### Fix: questions about facts inside documents ("contractor price of the cordless drill")
The question wasn't answered although the price list was uploaded. Three causes, all fixed:
1. Embedding search is weak on product names and SKUs. Search is now hybrid: Pinecone plus
   PostgreSQL full-text, merged by reciprocal rank fusion; a passage containing two or more of
   the question's distinctive words counts as relevant even with a low embedding score.
2. The planner saw only a passage's first 300 characters (the price list's introduction).
   It now sees the lines that match the question.
3. A document question routed to data analysis had no way back. If the planner asks for
   clarification, calls the question unsupported, or produces a data plan that can't run, and
   the documents clearly match, the analyst answers from the documents first.
Covered by AI tests (30) and `phase6_e2e.py`, which uploads the real price list and asks the question.

## Phase 7 verification

- Engine: 86 tests, including the PDF renderer (all sections as text, escaping of untrusted
  text, pagination) and the render endpoint
- AI package: 34 tests: grounded report summaries, retry, template fallback with no invented
  recommendations
- `phase7_e2e.py`: a report from two years of orders with every expected section, the
  missing product column listed under "Not included", total revenue equal to pandas, a rising
  trend, the Northeast collapse flagged, the PDF downloaded and read back, the key-figures CSV,
  a share link opened signed-out (read-only, PDF works, only the token's hash stored), sharing
  turned off and the link refused, another workspace refused. Phase 1–6 suites re-run: pass.

### Issues found and fixed during verification
1. Monthly trends (reports and the analyst) included a month still in progress, which read
   as a drop and distorted the first-to-last change. It's now labelled "(partial)" and left
   out of trend figures.
2. The PDF repeated each key figure as a bullet under the cards; chart axes used a serif font.

## Phase 8 verification

- Engine: 93 tests, including briefings (same-weekday comparison, weekly and monthly periods,
  stale data), row-condition alerts, and Monday-to-Sunday weeks
- Web: 33 tests, including schedules across both daylight-saving changes, skipped and repeated
  hours, and other time zones; AI: 35 tests including the briefing summary template
- `phase8_e2e.py`: the tick refuses a missing or wrong secret; a daily briefing created, run,
  notified and shown on the dashboard, with the out-of-date warning; a scheduled run through the
  tick moving the next run forward; **two simultaneous ticks running the occurrence once**; a
  revenue-drop alert triggering and not re-notifying on unchanged data; a low-stock alert on an
  inventory file listing exactly the right SKUs; a weekly review producing a report; a broken
  workflow paused after five failures with a notification; another workspace refused.
  Phase 1–7 suites re-run: pass.

### Issues found and fixed during verification
1. **Weeks ran Tuesday to Monday everywhere** (analyst, anomalies, forecasts): pandas' "W-MON"
   means weeks *ending* Monday. Weeks now run Monday to Sunday ("W-SUN"), with a test.
2. A schedule at an hour skipped by the spring DST change resolved an hour early; it now runs
   just after the jump, and a repeated autumn hour runs once.
