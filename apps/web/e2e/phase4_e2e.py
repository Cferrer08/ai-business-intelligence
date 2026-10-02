"""Phase 4 end-to-end suite: charts, chart controls, exports, pinning and the live dashboard.

Same setup as phase3_e2e.py (stand-in model on :8765, real engine and PostgreSQL).
"""
import csv
import io
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


def money(v):
    return f"{v:,.0f}" if abs(v) >= 10_000 else f"{v:,.2f}"


def sales_csv() -> Path:
    rows = ["Order ID,Order Date,Customer ID,Region,Units,Revenue"]
    regions = ["Northeast", "South", "West", "Midwest"]
    for i in range(300):
        month = 1 + i // 34
        units = 1 + (i * 7) % 12
        price = 10.0 if (regions[i % 4] == "Northeast" and month == 8) else 24.5
        rows.append(f"ORD-{i:04d},2026-{month:02d}-{1 + i % 27:02d},C{(i * 13) % 40:03d},{regions[i % 4]},{units},\"${units * price:,.2f}\"")
    p = Path(tempfile.mkdtemp()) / "sales.csv"
    p.write_text("\n".join(rows) + "\n")
    return p


def ask(page, text):
    before = page.locator("article").count() + page.get_by_text("Not available yet").count()
    page.fill("#question", text)
    page.get_by_role("button", name="Ask", exact=True).click()
    page.wait_for_function(
        "(n) => document.querySelectorAll('article').length + [...document.querySelectorAll('p')].filter(p => p.textContent === 'Not available yet').length > n",
        arg=before, timeout=60_000)
    return page.locator("article").last


csv_path = sales_csv()
df = pd.read_csv(csv_path)
df["Revenue"] = df["Revenue"].str.replace(r"[$,]", "", regex=True).astype(float)
df["Order Date"] = pd.to_datetime(df["Order Date"])

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1400, "height": 950}, accept_downloads=True)
    a = ctx.new_page()
    a.goto(B + "/signup")
    a.fill("#name", "Ines Mora"); a.fill("#email", f"ines-{RUN}@example.com"); a.fill("#password", "phase4-password!")
    a.click("button[type=submit]"); a.wait_for_url("**/onboarding")
    a.fill("#name", "Mora Supply"); a.click("button[type=submit]"); a.wait_for_url("**/dashboard")
    a.goto(B + "/data"); a.set_input_files("input[type=file]", str(csv_path)); a.wait_for_url("**/data/*", timeout=60_000)

    # 1. Trend: line chart, switchable to bar and table
    a.goto(B + "/analyst")
    a.get_by_role("button", name="Show monthly Revenue trends").click()
    a.wait_for_url("**/analyst/*", timeout=60_000)
    card = a.locator("article").last
    expect(card.locator(".recharts-line-curve")).to_have_count(1)
    card.get_by_role("button", name="Bar", exact=True).click()
    expect(card.locator(".recharts-bar-rectangle")).to_have_count(9)
    card.get_by_role("button", name="Table", exact=True).click()
    expect(card.locator("table")).to_be_visible()
    card.get_by_role("button", name="Line", exact=True).click()

    # 2. Requested pie for a time series: refused with a reason, line shown
    card = ask(a, "monthly revenue as a pie chart")
    expect(card).to_contain_text("pie chart doesn't suit this result")
    expect(card.locator(".recharts-line-curve")).to_have_count(1)

    # 3. Pie by region (4 complete groups) + exports + pin
    card = ask(a, "Show revenue by region as a pie chart")
    expect(card.locator(".recharts-pie-sector")).to_have_count(4)
    card.get_by_role("button", name="Bar", exact=True).click()
    expect(card.locator(".recharts-bar-rectangle")).to_have_count(4)
    with a.expect_download() as d:
        card.locator("summary", has_text="Download").click(); card.get_by_role("button", name="Data (CSV)").click()
    rows = list(csv.reader(io.StringIO(Path(d.value.path()).read_text(encoding="utf-8-sig"))))
    totals = df.groupby("Region").Revenue.sum()
    assert rows[0] == ["Region", "Revenue"], rows[0]
    assert {r[0]: round(float(r[1]), 2) for r in rows[1:]} == {k: round(v, 2) for k, v in totals.items()}
    with a.expect_download() as d:
        card.locator("summary", has_text="Download").click(); card.get_by_role("button", name="Vector (SVG)").click()
    svg = Path(d.value.path()).read_text()
    assert svg.startswith("<svg") and "Revenue share by region" in svg and "recharts-bar" in svg
    with a.expect_download() as d:
        card.locator("summary", has_text="Download").click(); card.get_by_role("button", name="Image (PNG)").click()
    assert Path(d.value.path()).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert d.value.suggested_filename == "revenue-share-by-region.png"
    card.get_by_role("button", name="Pin to dashboard").click()
    expect(card.get_by_role("button", name="Pinned to dashboard")).to_be_visible()

    # 4. Expand dialog
    card.get_by_role("button", name="Expand").click()
    dialog = a.get_by_role("dialog", name="Revenue share by region")
    expect(dialog.locator(".recharts-bar-rectangle")).to_have_count(4)
    a.screenshot(path=str(SHOTS / "p4-1-expanded.png"))
    dialog.get_by_role("button", name="Close").click()
    expect(dialog).to_have_count(0)

    # 5. Scatter by customer; switch to bar and cut to top 5
    card = ask(a, "scatter of revenue and units by customer")
    expect(card.locator(".recharts-scatter-symbol")).to_have_count(df["Customer ID"].nunique())
    card.get_by_role("button", name="Bar", exact=True).click()
    card.get_by_label("Show").select_option("5")
    expect(card.locator(".recharts-bar-rectangle")).to_have_count(10)  # two series x 5 customers

    # 6. Distribution: one bar per distinct unit count
    card = ask(a, "what does the distribution of units look like")
    expect(card.locator(".recharts-bar-rectangle")).to_have_count(df.Units.nunique())
    med = df.Units.median()  # plain numbers: whole, or up to 2 decimals without trailing zeros
    expect(card).to_contain_text(f"Median Units: {med:,.0f}" if med % 1 == 0 else f"Median Units: {med:,.2f}".rstrip("0").rstrip("."))

    # 7. Why: diverging bars coloured by direction
    card = ask(a, "Why did Revenue change last month?")
    expect(card.locator(".recharts-bar-rectangle")).to_have_count(4)
    a.wait_for_timeout(600)  # let the entry animation finish drawing
    fills = card.locator(".recharts-bar-rectangle path, .recharts-bar-rectangle rect").evaluate_all("els => els.map(e => e.getAttribute('fill'))")
    assert "#B42318" in fills and "#1E7A4F" in fills, fills
    a.screenshot(path=str(SHOTS / "p4-2-analyst.png"), full_page=True)

    # 8. Dashboard: KPIs equal pandas for the latest complete month (August; September is partial)
    a.goto(B + "/dashboard")
    aug = df[(df["Order Date"] >= "2026-08-01") & (df["Order Date"] < "2026-09-01")]
    jul = df[(df["Order Date"] >= "2026-07-01") & (df["Order Date"] < "2026-08-01")]
    expect(a.get_by_text("August 2026, compared with July 2026")).to_be_visible()
    overview = a.locator("section[aria-labelledby=overview]")
    expect(overview).to_contain_text(money(aug.Revenue.sum()))
    expect(overview).to_contain_text(f"{abs(100 * (aug.Revenue.sum() - jul.Revenue.sum()) / jul.Revenue.sum()):.1f}%")
    expect(overview).to_contain_text(money(aug.Revenue.sum() / aug["Order ID"].nunique()))
    expect(overview.locator("dd").filter(has_text=str(aug["Customer ID"].nunique())).first).to_be_visible()
    expect(overview.locator(".recharts-line-curve")).to_have_count(1)
    expect(overview).to_contain_text("Biggest changes in August 2026")
    pinned = a.locator("section[aria-labelledby=pinned]")
    expect(pinned).to_contain_text("Revenue share by region")
    expect(pinned.locator(".recharts-bar-rectangle")).to_have_count(4)  # pinned as the bar view
    expect(a.locator("section[aria-labelledby=recent] li")).to_have_count(5)
    a.screenshot(path=str(SHOTS / "p4-3-dashboard.png"), full_page=True)
    pinned.get_by_role("button", name="Unpin").click()
    expect(a.locator("section[aria-labelledby=pinned]")).to_have_count(0)

    # 9. Health reports migrations current
    h = a.request.get(B + "/api/health").json()
    assert h["migrations"] == "current", h

    # 10. Another workspace sees none of this
    b = br.new_context().new_page()
    b.goto(B + "/signup")
    b.fill("#name", "Ola Berg"); b.fill("#email", f"ola-{RUN}@example.com"); b.fill("#password", "phase4-password!")
    b.click("button[type=submit]"); b.wait_for_url("**/onboarding")
    b.fill("#name", "Berg Bikes"); b.click("button[type=submit]"); b.wait_for_url("**/dashboard")
    expect(b.get_by_text("Upload a dataset with dates and revenue")).to_be_visible()
    assert "Revenue share by region" not in b.content()
    br.close()
print("ALL PHASE 4 E2E CHECKS PASSED")
