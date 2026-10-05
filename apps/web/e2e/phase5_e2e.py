"""Phase 5 end-to-end suite: forecasts, anomalies, correlation, segments and trend, through
both the new pages and the AI analyst. The dataset has planted answers. Same setup as
phase3_e2e.py (stand-in model on :8765, real engine and PostgreSQL)."""
import os
import tempfile
import uuid
from pathlib import Path

import numpy as np
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


def dataset() -> Path:
    """Two years of daily orders: weekday pattern, yearly season, growth, and three planted
    answers: a spike on 2026-03-11, Northeast collapsing in August 2026, one huge order."""
    rng = np.random.default_rng(11)
    rows = []
    n = 0
    for d in pd.date_range("2024-10-01", "2026-09-27", freq="D"):
        season = 1 + 0.25 * np.sin(2 * np.pi * (d.dayofyear - 80) / 365)
        growth = 1 + 0.15 * (d - pd.Timestamp("2024-10-01")).days / 365
        week = 0.5 if d.dayofweek >= 5 else 1.0
        spike = 4.0 if d == pd.Timestamp("2026-03-11") else 1.0
        for k in range(4):
            region = ["Northeast", "South", "West", "Midwest"][k]
            collapse = 0.3 if (region == "Northeast" and d.year == 2026 and d.month == 8) else 1.0
            units = int(rng.integers(1, 6))
            price = 40 * season * growth * week * spike * collapse
            cust = f"C{int(rng.integers(0, 150)):03d}" if rng.random() > 0.3 else f"C{int(rng.integers(0, 20)):03d}"
            rows.append({"Order ID": f"ORD-{n:05d}", "Order Date": d.strftime("%Y-%m-%d"), "Customer ID": cust,
                         "Region": region, "Units": units, "Revenue": round(units * price * rng.uniform(0.95, 1.05), 2)})
            n += 1
    rows[500]["Revenue"] = 45000.0  # the huge order, file row 502
    p = Path(tempfile.mkdtemp()) / "orders_2y.csv"
    pd.DataFrame(rows).to_csv(p, index=False)
    return p


def run_and_wait(page, path):
    """Click Run and wait for a NEW run id in the URL (not the one already shown)."""
    before = page.url
    page.get_by_role("button", name="Run").click()
    page.wait_for_function(
        "(b) => (location.href !== b && location.search.includes('run=')) || document.querySelector('p[role=alert]')",
        arg=before, timeout=90_000)
    alert = page.locator("p[role=alert]")
    assert alert.count() == 0, f"run refused: {alert.inner_text()}"


def ask(page, text):
    before = page.locator("article").count()
    page.fill("#question", text)
    page.get_by_role("button", name="Ask", exact=True).click()
    page.wait_for_function("(n) => document.querySelectorAll('article').length > n", arg=before, timeout=90_000)
    return page.locator("article").last


csv_path = dataset()

with sync_playwright() as p:
    br = p.chromium.launch()
    a = br.new_context(viewport={"width": 1400, "height": 950}).new_page()
    a.goto(B + "/signup")
    a.fill("#name", "Tomas Reyes"); a.fill("#email", f"tomas-{RUN}@example.com"); a.fill("#password", "phase5-password!")
    a.click("button[type=submit]"); a.wait_for_url("**/onboarding")
    a.fill("#name", "Reyes Garden Co"); a.click("button[type=submit]"); a.wait_for_url("**/dashboard")
    a.goto(B + "/data"); a.set_input_files("input[type=file]", str(csv_path)); a.wait_for_url("**/data/*", timeout=90_000)

    # 1. Forecasts page: monthly revenue, 6 ahead; partial September left out of history
    a.goto(B + "/forecasts")
    expect(a.locator("select[name=metric]")).to_have_value("Revenue")
    a.locator("select[name=grain]").select_option("month")
    a.locator("input[name=horizon]").fill("6")
    run_and_wait(a, "forecasts")
    result = a.locator("article")
    expect(result).to_contain_text("The forecast for September 2026 is")
    expect(result.locator(".recharts-area")).to_have_count(2)  # 80% and 95% bands
    expect(result).to_contain_text("Method:")
    expect(result).to_contain_text("incomplete")
    expect(result).to_contain_text("doesn't include seasonality")  # 23 months: too short for a yearly cycle
    # History is drawn: the actual line has a path with many points, not just forecast dots
    a.wait_for_timeout(800)
    d = result.locator(".recharts-line-curve").first.get_attribute("d") or ""
    assert d.count("L") + d.count("C") >= 20, d[:80]
    result.get_by_text("Show data").click()
    expect(result.locator("table").first.locator("tbody tr")).to_have_count(6)
    a.screenshot(path=str(SHOTS / "p5-1-forecast.png"), full_page=True)
    assert q("select count(*) from forecasts")[0][0] >= 1

    # Too little history is refused with a reason, not a made-up forecast
    a.locator("select[name=grain]").select_option("quarter")
    a.get_by_role("button", name="Run").click()
    expect(a.locator("p[role=alert]")).to_contain_text("needs at least 8")

    # 2. Anomalies: unusual days find the planted spike
    a.goto(B + "/anomalies")
    a.locator("select[name=grain]").select_option("day")
    run_and_wait(a, "anomalies")
    result = a.locator("article")
    result.get_by_text("Show data").click()
    expect(result.locator("table")).to_contain_text("Mar 11, 2026")
    expect(result).to_contain_text("Why it was flagged")
    # Exactly the two planted events: the spike day and the day of the $45,000 order
    expect(result.locator("circle.anomaly-dot")).to_have_count(2)
    expect(result.locator("table")).to_contain_text("Feb 3, 2025")
    a.screenshot(path=str(SHOTS / "p5-2-anomalies.png"), full_page=True)

    # ...groups: Northeast in August 2026
    a.locator("select[name=scope]").select_option("groups")
    a.locator("select[name=grain]").select_option("month")
    a.locator("select[name=dimension]").select_option("Region")
    run_and_wait(a, "anomalies")
    result = a.locator("article")
    expect(result).to_contain_text("Northeast")
    result.get_by_text("Show data").click()
    row = result.locator("tr", has_text="Northeast")
    expect(row).to_contain_text("Unusual")
    for other in ["South", "West", "Midwest"]:
        expect(result.locator("tr").filter(has=a.get_by_role("cell", name=other, exact=True))).not_to_contain_text("Unusual")

    # ...rows: the huge order, by file row number and order id
    a.locator("select[name=scope]").select_option("records")
    run_and_wait(a, "anomalies")
    result = a.locator("article")
    result.get_by_text("Show data").click()
    expect(result.locator("tbody tr").first).to_contain_text("ORD-00500")
    expect(result.locator("tbody tr").first).to_contain_text("502")

    # 3. Analytics: correlation, segments, trend
    a.goto(B + "/analytics?tab=correlation")
    run_and_wait(a, "analytics")
    result = a.locator("article")
    expect(result).to_contain_text("Units and Revenue")
    expect(result.locator("td[title^='Units and Revenue']")).to_have_count(1)
    a.goto(B + "/analytics?tab=segmentation")
    run_and_wait(a, "analytics")
    result = a.locator("article")
    expect(result).to_contain_text("customers grouped by")
    result.get_by_text("Show data").click()
    expect(result.locator("table")).to_contain_text("Champions")
    a.screenshot(path=str(SHOTS / "p5-3-segments.png"), full_page=True)
    a.goto(B + "/analytics?tab=trend")
    a.locator("select[name=grain]").select_option("month")
    run_and_wait(a, "analytics")
    expect(a.locator("article")).to_contain_text("rising")  # 15% yearly growth is planted

    # 4. The analyst answers the same questions
    a.goto(B + "/analyst")
    a.fill("#question", "Forecast revenue for the next 3 months")
    a.get_by_role("button", name="Ask", exact=True).click()
    a.wait_for_url("**/analyst/*", timeout=90_000)
    card = a.locator("article").last
    expect(card.locator(".recharts-area")).to_have_count(2)
    card = ask(a, "Were there any unusual days for revenue?")
    expect(card.locator("circle.anomaly-dot").first).to_be_visible()
    card = ask(a, "segment my customers")
    expect(card.locator(".recharts-bar-rectangle").first).to_be_visible()
    card = ask(a, "Is revenue growing?")
    expect(card.locator(".recharts-line-curve")).to_have_count(2)  # values and trend line
    a.screenshot(path=str(SHOTS / "p5-4-analyst.png"), full_page=True)

    # 5. Another workspace can't open these runs
    run_id = q("select id from forecasts order by created_at desc limit 1")[0][0]
    b = br.new_context().new_page()
    b.goto(B + "/signup")
    b.fill("#name", "Uma Patel"); b.fill("#email", f"uma-{RUN}@example.com"); b.fill("#password", "phase5-password!")
    b.click("button[type=submit]"); b.wait_for_url("**/onboarding")
    b.fill("#name", "Patel Foods"); b.click("button[type=submit]"); b.wait_for_url("**/dashboard")
    b.goto(B + f"/forecasts?run={run_id}"); expect(b.get_by_text("Page not found")).to_be_visible()
    b.goto(B + "/forecasts"); expect(b.get_by_text("No runs yet.")).to_be_visible()
    br.close()
print("ALL PHASE 5 E2E CHECKS PASSED")
