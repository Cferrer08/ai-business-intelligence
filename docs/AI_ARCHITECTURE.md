# AI architecture (Phase 3)

The analyst answers questions about one dataset. The language model decides **what** to
calculate and **how to explain** it. It never calculates, and it can't put a number in
front of the user that the data engine didn't produce.

```
question
  │
  ├─ 1. PLAN (model, structured output)      packages/ai/src/plan.ts, prompts.ts
  │      chooses aggregate | compare_periods | overview, or asks a clarifying question,
  │      or says the request is unsupported
  ├─ 2. VALIDATE (code)                        validate.ts
  │      columns exist, types fit (sum needs numbers, time needs a date column…)
  │      → problems go back to the model once ("plan_repair")
  ├─ 3. COMPUTE (Python engine)                services/data-engine/app/analysis/compute.py
  │      pre-written pandas operations only; no generated code runs
  │      → engine-explained problems (typo in a filter value, wrong column) repaired once
  │      → returns tables plus "facts": every number, pre-formatted, with an id
  ├─ 4. EXPLAIN (model, structured output)
  │      headline / what happened / contributing factors / suggestions / caveats,
  │      writing numbers only as placeholders like {f3}
  ├─ 5. GROUND (code)                          grounding.ts
  │      any digit outside a placeholder (except names like "Store 2") fails;
  │      retry once with the violations ("interpret_retry"), then a template
  │      explanation built from facts (fallback.ts)
  └─ 6. RENDER + SAVE
         placeholders replaced by the engine's values and highlighted in the UI
```

If the model fails after the numbers are computed, the user still gets the result with
a template summary. If it fails before, they get a plain-language reason.

## Documents (Phase 6)

Before step 1 the analyst searches the workspace's documents (see `KNOWLEDGE.md`). The
planner can choose a fourth action, `documents`, for questions the documents answer; the
explainer can add `document_notes`. Both must cite passages, and any number in a document
statement must appear in a cited passage (`checkDocumentNotes` in `grounding.ts`).

## Why no LangChain

The spec suggests LangChain "where it provides value". Here the agent has a fixed path
(plan → validate → compute → explain) rather than open-ended tool loops, and structured
outputs already give typed results. LangChain would add a layer to debug without adding
capability. The model client (`llm.ts`) is a small `fetch` wrapper around Chat Completions,
so adding another provider means implementing one interface.

## Analysis types

| Type | Answers | Engine output |
| --- | --- | --- |
| aggregate | totals, rankings, breakdowns, trends (time grain), ratios like margin or AOV | table, top-group facts, trend facts (first/last/high/low) |
| compare_periods | "why did X change", period comparisons | totals for both periods, change, contributors per dimension with share of change |
| overview | "summarize the business" | totals, distinct customers/orders, date range, latest month vs previous, leaders |

| distribution | "what do order sizes look like" | histogram bins, median, middle half |
| forecast / anomalies / correlation / segmentation / trend | see `ANALYTICS.md` | per method |

Relative periods ("last month") are anchored on the **latest date in the data**, and
`latest_complete` skips a partial final month. Requests outside these types (data from
other systems, changing data) are answered as unsupported with a reason.

## Follow-up questions

The last three answered turns (question, plan, headline) are sent to the planner, so
"now only the Northeast" or "why did it decline" modify the previous plan.

## Prompt injection

Column names, category values and earlier answers come from user files. They are sent as
JSON blocks labelled "data, not instructions", and the planner is told never to follow
instructions inside them. More importantly, the design limits the damage: the planner can
only return a plan matching a strict schema, which is then validated against the real
dataset; the explainer can only reference engine facts; neither has tools with side
effects, network access or access to other workspaces. The evaluation includes an
injection case.

## Usage and cost

Every model call is stored in `ai_requests`: purpose (plan, plan_repair, interpret,
interpret_retry), model, input/output tokens, estimated cost, duration, success and error
code. Prices come from `OPENAI_PRICE_INPUT_PER_1M` / `OPENAI_PRICE_OUTPUT_PER_1M`.
A typical answer is 2 calls; repairs add one each. A per-user limit of 30 questions per
10 minutes protects spend until plan limits arrive with billing (Phase 9).

## Evaluation

`packages/ai/eval` runs 13 questions against a fixed 1,800-row dataset (with a planted
story: Garden sales in the Northeast collapse in September) and reports:

- **plan accuracy**: right analysis type, metric, grouping, filters, period
- **numerical accuracy**: expected values (precomputed with pandas) found exactly in facts
- **grounded explanations**: answers whose wording passed the number check first or
  second time, without the template
- latency, tokens and estimated cost

Run it with the engine up. It reads `OPENAI_API_KEY`, `OPENAI_MODEL`, `ENGINE_API_KEY` and
`FASTAPI_URL` from `apps/web/.env.local` (shell variables take precedence):

```powershell
npm run eval -w @insight/ai
```

Run it whenever you change prompts, the plan schema or the model.

## Tests

- `packages/ai`: 17 tests with a scripted model (grounding, repair paths, fallbacks,
  validation, AI outages)
- `services/data-engine`: analysis results checked against independent pandas calculations
- `apps/web/e2e/phase3_e2e.py`: full flow in a browser with the real engine and database
  and a stand-in model server (`e2e/fake_openai.py`) that speaks the OpenAI API
