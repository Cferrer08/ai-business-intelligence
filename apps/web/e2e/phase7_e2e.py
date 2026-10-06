"""Phase 7 end-to-end suite: business reports, PDF and CSV export, share links.
Same setup as phase3_e2e.py (stand-in model on :8765, real engine and PostgreSQL)."""
import io
import os
import tempfile
import uuid
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg
from playwright.sync_api import expect, sync_playwright
from pypdf import PdfReader

B = os.environ.get("E2E_BASE_URL", "http://localhost:3000")
DB_URL = os.environ.get("DATABASE_URL", "postgresql://insight:insight@127.0.0.1:5432/insight_ai")
SHOTS = Path(os.environ.get("E2E_SHOTS", "e2e-shots")); SHOTS.mkdir(exist_ok=True)
RUN = uuid.uuid4().hex[:6]


def q(sql, *args):
    with psycopg.connect(DB_URL, autocommit=True) as c:
        cur = c.execute(sql, args)
        return cur.fetchall() if cur.description else None


def money(v):
    return f"{v:,.0f}" if abs(v) >= 10_000 else f"{v:,.2f}"


def dataset() -> tuple[Path, pd.DataFrame]:
    rng = np.random.default_rng(11)
    rows, n = [], 0
    for d in pd.date_range("2024-10-01", "2026-09-27", freq="D"):
        season = 1 + 0.25 * np.sin(2 * np.pi * (d.dayofyear - 80) / 365)
        growth = 1 + 0.15 * (d - pd.Timestamp("2024-10-01")).days / 365
        week = 0.5 if d.dayofweek >= 5 else 1.0
        for k, region in enumerate(["Northeast", "South", "West", "Midwest"]):
            collapse = 0.3 if (region == "Northeast" and d.year == 2026 and d.month == 8) else 1.0
            units = int(rng.integers(1, 6))
            rows.append({"Order ID": f"ORD-{n:05d}", "Order Date": d.strftime("%Y-%m-%d"), "Customer ID": f"C{int(rng.integers(0, 150)):03d}",
                         "Region": region, "Units": units, "Revenue": round(units * 40 * season * growth * week * collapse * rng.uniform(0.95, 1.05), 2)})
            n += 1
    df = pd.DataFrame(rows)
    p = Path(tempfile.mkdtemp()) / "orders_2y.csv"
    df.to_csv(p, index=False)
    return p, df


csv_path, df = dataset()
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1400, "height": 950}, accept_downloads=True)
    a = ctx.new_page()
    a.goto(B + "/signup")
    a.fill("#name", "Vera Ruiz"); a.fill("#email", f"vera-{RUN}@example.com"); a.fill("#password", "phase7-password!")
    a.click("button[type=submit]"); a.wait_for_url("**/onboarding")
    a.fill("#name", "Ruiz Garden"); a.click("button[type=submit]"); a.wait_for_url("**/dashboard")
    a.goto(B + "/data"); a.set_input_files("input[type=file]", str(csv_path)); a.wait_for_url("**/data/*", timeout=90_000)

    # 1. Generate the report
    a.goto(B + "/reports")
    a.get_by_role("button", name="Generate business report").click()
    a.wait_for_url("**/reports/*", timeout=120_000)
    expect(a.get_by_role("heading", name="orders 2y business report, August 2026")).to_be_visible()
    for heading in ["Executive summary", "Key figures", "Revenue by month", "Is revenue growing?", "What changed last month",
                    "Regional performance", "Customer segments", "Unusual days", "Regions with an unusual month", "Forecast",
                    "Key risks", "Recommended actions"]:
        expect(a.get_by_role("heading", name=heading, exact=False).first).to_be_visible()
    body = a.locator("main, body").first
    expect(body).to_contain_text("Product performance: no product or category column was recognised")   # skipped with reason
    expect(body).to_contain_text(money(df.Revenue.sum()))                                                # total revenue = pandas
    expect(body).to_contain_text("rising")                                                               # 15% yearly growth
    expect(a.locator("section[aria-labelledby='sec-anomalies_groups']")).to_contain_text("Northeast")    # the collapse
    expect(a.locator("section[aria-labelledby='actions'] li")).to_have_count(1)                         # AI suggestion, labelled
    report_id = a.url.rsplit("/", 1)[1]
    assert q("select status::text from reports where id=%s", report_id)[0][0] == "ready"
    a.wait_for_timeout(800)
    a.screenshot(path=str(SHOTS / "p7-1-report.png"), full_page=True)

    # 2. PDF: real file with the report's text
    with a.expect_download() as d:
        a.get_by_role("link", name="Download PDF").click()
    pdf = Path(d.value.path()).read_bytes()
    assert pdf[:5] == b"%PDF-" and d.value.suggested_filename.endswith(".pdf")
    text = " ".join(pg.extract_text() for pg in PdfReader(io.BytesIO(pdf)).pages)
    for expected in ["orders 2y business report", "Executive summary", "Key figures", "Regional performance", "Forecast",
                     "Recommended actions", "not calculations", "Not included", money(df.Revenue.sum())]:
        assert expected in text, expected
    (SHOTS / "p7-report.pdf").write_bytes(pdf)

    # 3. CSV of key figures
    with a.expect_download() as d:
        a.get_by_role("link", name="Key figures (CSV)").click()
    csv_text = Path(d.value.path()).read_text(encoding="utf-8-sig")
    assert csv_text.startswith("Section,Measure,Value,As shown") and "Regional performance" in csv_text

    # 4. Share link: works without signing in, then turned off
    a.get_by_role("button", name="Share link").click()
    link = a.get_by_label("Share link").input_value()
    assert "/r/" in link
    token = link.rsplit("/r/", 1)[1]
    assert q("select share_token_hash from reports where id=%s", report_id)[0][0] != token   # only the hash is stored
    anon = br.new_context(accept_downloads=True).new_page()
    anon.goto(B + f"/r/{token}")
    expect(anon.get_by_role("heading", name="orders 2y business report, August 2026")).to_be_visible()
    expect(anon.get_by_text("Read-only")).to_be_visible()
    assert anon.locator("text=Delete").count() == 0 and anon.locator("text=Share link").count() == 0
    r = anon.request.get(B + f"/r/{token}/pdf")
    assert r.status == 200 and r.body()[:5] == b"%PDF-"
    a.get_by_role("button", name="Turn off sharing").click()
    a.wait_for_timeout(500)
    anon.goto(B + f"/r/{token}")
    expect(anon.get_by_text("This link isn't available")).to_be_visible()
    assert anon.request.get(B + f"/r/{token}/pdf").status == 404
    assert anon.request.get(B + "/r/not-a-real-token-but-long-enough-to-pass-the-format-check-000").status == 200   # friendly page, no data
    expect(anon.get_by_text("This link isn't available")).to_be_visible()

    # 5. Saved and listed
    a.goto(B + "/reports")
    expect(a.get_by_text("orders 2y business report, August 2026")).to_be_visible()

    # 6. Another workspace can't open it or its exports
    b = br.new_context().new_page()
    b.goto(B + "/signup")
    b.fill("#name", "Wes Kim"); b.fill("#email", f"wes-{RUN}@example.com"); b.fill("#password", "phase7-password!")
    b.click("button[type=submit]"); b.wait_for_url("**/onboarding")
    b.fill("#name", "Kim Tools"); b.click("button[type=submit]"); b.wait_for_url("**/dashboard")
    b.goto(B + f"/reports/{report_id}"); expect(b.get_by_text("Page not found")).to_be_visible()
    assert b.request.get(B + f"/api/reports/{report_id}/pdf").status == 404
    assert b.request.get(B + f"/api/reports/{report_id}/csv").status == 404
    br.close()
print("ALL PHASE 7 E2E CHECKS PASSED")
