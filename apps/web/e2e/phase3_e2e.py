"""Phase 3 end-to-end suite: the AI analyst against the real engine and database.

The model is replaced by e2e/fake_openai.py (same HTTP API), so this checks the pipeline,
not the model's judgement. Run the web app with:
    OPENAI_API_KEY=test-openai-key  OPENAI_BASE_URL=http://127.0.0.1:8765/v1
and start the stand-in:  python apps/web/e2e/fake_openai.py 8765
To score the real model, use the evaluation in packages/ai/eval (see docs/AI_ARCHITECTURE.md).
"""
import os
import tempfile
import uuid
from pathlib import Path

import pandas as pd
import psycopg
from playwright.sync_api import expect, sync_playwright

B = os.environ.get("E2E_BASE_URL", "http://localhost:3000")
DB_URL = os.environ.get("DATABASE_URL", "postgresql://insight:insight@127.0.0.1:5432/insight_ai")
SHOTS = Path(os.environ.get("E2E_SHOTS", "e2e-shots")); SHOTS.mkdir(exist_ok=True)
RUN = uuid.uuid4().hex[:6]


def q(sql, *args):
    with psycopg.connect(DB_URL, autocommit=True) as c:
        cur = c.execute(sql, args)
        return cur.fetchall() if cur.description else None


def sales_csv() -> Path:
    rows = ["Order ID,Order Date,Customer ID,Region,Units,Revenue"]
    regions = ["Northeast", "South", "West", "Midwest"]
    for i in range(300):
        month = 1 + i // 34
        units = 1 + (i * 7) % 12
        # Northeast drops sharply in the last full month so "why" has a clear answer
        price = 10.0 if (regions[i % 4] == "Northeast" and month == 8) else 24.5
        rows.append(f"ORD-{i:04d},2026-{month:02d}-{1 + i % 27:02d},C{(i * 13) % 40:03d},{regions[i % 4]},{units},\"${units * price:,.2f}\"")
    p = Path(tempfile.mkdtemp()) / "sales.csv"
    p.write_text("\n".join(rows) + "\n")
    return p


def money(v):
    """The app's display rule for money (engine facts and tables agree on it)."""
    return f"{v:,.0f}" if abs(v) >= 10_000 else f"{v:,.2f}"


def ask(page, text):
    n = page.locator("article, [class*='border-down'], p:has-text('A quick question first'), p:has-text('Not available yet')").count()
    page.fill("#question", text)
    page.get_by_role("button", name="Ask", exact=True).click()
    page.wait_for_function("(n) => document.querySelectorAll('#question:not([disabled])').length === 1", arg=n, timeout=60_000)


csv = sales_csv()
df = pd.read_csv(csv)
df["Revenue"] = df["Revenue"].str.replace(r"[$,]", "", regex=True).astype(float)
df["Order Date"] = pd.to_datetime(df["Order Date"])
monthly = df.groupby(df["Order Date"].dt.to_period("M"))["Revenue"].sum()

with sync_playwright() as p:
    br = p.chromium.launch()
    a = br.new_context(viewport={"width": 1400, "height": 950}).new_page()
    a.goto(B + "/signup")
    a.fill("#name", "Rosa Lin"); a.fill("#email", f"rosa-{RUN}@example.com"); a.fill("#password", "phase3-password!")
    a.click("button[type=submit]"); a.wait_for_url("**/onboarding")
    a.fill("#name", "Lin Hardware"); a.click("button[type=submit]"); a.wait_for_url("**/dashboard")
    a.goto(B + "/data"); a.set_input_files("input[type=file]", str(csv)); a.wait_for_url("**/data/*", timeout=60_000)

    # 1. Monthly trend: table values equal pandas, numbers come from engine facts
    a.goto(B + "/analyst")
    expect(a.get_by_role("button", name="Show monthly Revenue trends")).to_be_visible()
    a.get_by_role("button", name="Show monthly Revenue trends").click()
    a.wait_for_url("**/analyst/*", timeout=60_000)
    card = a.locator("article").last
    expect(card).to_contain_text("Revenue peaked in")
    peak = monthly.idxmax().strftime("%B %Y")
    expect(card.locator("[data-fact]").first).to_have_text(peak)
    for period, value in monthly.items():
        expect(card).to_contain_text(money(value))
    conv = a.url.rsplit("/", 1)[1]
    a.screenshot(path=str(SHOTS / "p3-1-trend.png"), full_page=True)
    expect(a.get_by_role("navigation", name="Analysis history")).to_contain_text("Show monthly Revenue trends")

    # 2. Follow-up keeps context and adds the filter
    ask(a, "Now only show the Northeast")
    card = a.locator("article").last
    expect(card).to_contain_text("Filtered to Region = Northeast")
    ne = df[df.Region == "Northeast"].groupby(df["Order Date"].dt.to_period("M"))["Revenue"].sum()
    expect(card).to_contain_text(money(ne.min()))

    # 3. Why did it change: compare periods with contributors, suggestions labelled
    ask(a, "Why did Revenue change last month?")
    card = a.locator("article").last
    aug, jul = monthly[pd.Period("2026-08")], monthly[pd.Period("2026-07")]
    expect(card).to_contain_text(f"{abs(100 * (aug - jul) / jul):.1f}%")
    expect(card).to_contain_text("August 2026")
    expect(card).to_contain_text("Contribution to the change by Region")
    expect(card).to_contain_text("can exceed 100%")  # Northeast fell more than the total
    # the headline amount and the table show the same figure
    expect(card.locator("[data-fact]").filter(has_text=money(aug))).to_have_count(1)
    expect(card.locator("table").first).to_contain_text(money(aug))
    expect(card).to_contain_text("AI suggestions, not calculations")
    card.get_by_text("How this was calculated").click()
    expect(card).to_contain_text("Highlighted numbers were calculated by the data engine")
    a.screenshot(path=str(SHOTS / "p3-2-why.png"), full_page=True)

    # 4. Unsupported request is explained, not faked
    ask(a, "Forecast revenue for the next 3 months")
    expect(a.get_by_text("Not available yet").last).to_be_visible()

    # 5. Typo in a filter value: engine suggests the real value, plan is repaired
    ask(a, "Total revenue in Nrtheast")
    card = a.locator("article").last
    expect(card).to_contain_text(money(df[df.Region == "Northeast"].Revenue.sum()))

    # 6. Model writes its own number: rejected, retried, grounded
    ask(a, "invent a summary of monthly revenue")
    expect(a.locator("article").last).to_contain_text("Revenue peaked in")
    assert "12%" not in a.locator("article").last.inner_text()

    # Storage and usage tracking
    rows = dict(q("select status::text, count(*) from analysis_requests where conversation_id=%s group by 1", conv))
    assert rows == {"succeeded": 5, "unsupported": 1}, rows
    purposes = {r[0] for r in q("select distinct purpose from ai_requests ar join analysis_requests r on r.id=ar.analysis_request_id where r.conversation_id=%s", conv)}
    assert {"plan", "plan_repair", "interpret", "interpret_retry"} <= purposes, purposes
    assert q("select min(input_tokens) > 0 and min(estimated_cost_usd) > 0 from ai_requests where succeeded")[0][0]

    # Reload keeps the conversation
    a.reload(); expect(a.locator("article")).to_have_count(5)

    # 7. Tenant isolation
    b = br.new_context().new_page()
    b.goto(B + "/signup")
    b.fill("#name", "Sam Ito"); b.fill("#email", f"sam-{RUN}@example.com"); b.fill("#password", "phase3-password!")
    b.click("button[type=submit]"); b.wait_for_url("**/onboarding")
    b.fill("#name", "Ito Cafe"); b.click("button[type=submit]"); b.wait_for_url("**/dashboard")
    b.goto(B + f"/analyst/{conv}"); expect(b.get_by_text("Page not found")).to_be_visible()
    r = b.request.post(B + "/api/analyst/chat", data={"question": "Show monthly revenue", "conversationId": conv})
    assert r.status == 404, r.status
    ds = q("select dataset_id from conversations where id=%s", conv)[0][0]
    r = b.request.post(B + "/api/analyst/chat", data={"question": "Show monthly revenue", "datasetId": str(ds)})
    assert r.status == 404, r.status
    b.goto(B + "/analyst"); expect(b.get_by_text("Upload a dataset first")).to_be_visible()
    br.close()
print("ALL PHASE 3 E2E CHECKS PASSED")
