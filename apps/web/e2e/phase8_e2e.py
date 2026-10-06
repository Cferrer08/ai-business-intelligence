"""Phase 8 end-to-end suite: workflows, the scheduler tick, alerts and notifications.
Same setup as phase3_e2e.py, plus the app started with CRON_SECRET=e2e-cron-secret-0123456789."""
import os
import tempfile
import threading
import uuid
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg
import requests
from playwright.sync_api import expect, sync_playwright

B = os.environ.get("E2E_BASE_URL", "http://localhost:3000")
SECRET = os.environ.get("E2E_CRON_SECRET", "e2e-cron-secret-0123456789")
DB_URL = os.environ.get("DATABASE_URL", "postgresql://insight:insight@127.0.0.1:5432/insight_ai")
SHOTS = Path(os.environ.get("E2E_SHOTS", "e2e-shots")); SHOTS.mkdir(exist_ok=True)
RUN = uuid.uuid4().hex[:6]
TMP = Path(tempfile.mkdtemp())


def q(sql, *args):
    with psycopg.connect(DB_URL, autocommit=True) as c:
        cur = c.execute(sql, args)
        return cur.fetchall() if cur.description else None


def tick():
    return requests.post(B + "/api/cron/tick", headers={"Authorization": f"Bearer {SECRET}"}, timeout=120)


def sales() -> Path:
    rng = np.random.default_rng(11)
    rows, n = [], 0
    for d in pd.date_range("2024-10-01", "2026-09-27", freq="D"):
        season = 1 + 0.25 * np.sin(2 * np.pi * (d.dayofyear - 80) / 365)
        for region in ["Northeast", "South", "West", "Midwest"]:
            collapse = 0.3 if (region == "Northeast" and d.year == 2026 and d.month == 8) else 1.0
            units = int(rng.integers(1, 6))
            rows.append({"Order ID": f"ORD-{n:05d}", "Order Date": d.strftime("%Y-%m-%d"), "Customer ID": f"C{int(rng.integers(0, 150)):03d}",
                         "Region": region, "Units": units, "Revenue": round(units * 40 * season * (0.5 if d.dayofweek >= 5 else 1) * collapse, 2)})
            n += 1
    p = TMP / "orders_2y.csv"; pd.DataFrame(rows).to_csv(p, index=False); return p


def inventory() -> Path:
    p = TMP / "inventory.csv"
    pd.DataFrame({"SKU": ["TL-1001", "TL-1002", "GD-2001", "GD-2010", "PT-3001"], "On hand": [3, 40, 0, 25, 6], "Reorder point": [10, 15, 5, 20, 8]}).to_csv(p, index=False)
    return p


def create(page, name, dataset, wtype, frequency="daily", extra=lambda p: None):
    page.goto(B + "/workflows")
    page.locator(f"input[name=type][value={wtype}]").check(force=True)
    page.fill("input[name=name]", name)
    page.locator("select[name=datasetId]").select_option(label=dataset)
    if wtype != "weekly_review":
        page.locator("select[name=frequency]").select_option(frequency)
    page.fill("input[name=timezone]", "America/New_York")
    extra(page)
    page.get_by_role("button", name="Create workflow").click()
    page.wait_for_url("**/workflows/*", timeout=30_000)
    return page.url.rsplit("/", 1)[1]


def run_now(page):
    page.get_by_role("button", name="Run now").click()
    page.wait_for_load_state("networkidle", timeout=120_000)


with sync_playwright() as p:
    br = p.chromium.launch()
    a = br.new_context(viewport={"width": 1400, "height": 950}).new_page()
    a.goto(B + "/signup")
    a.fill("#name", "Lena Park"); a.fill("#email", f"lena-{RUN}@example.com"); a.fill("#password", "phase8-password!")
    a.click("button[type=submit]"); a.wait_for_url("**/onboarding")
    a.fill("#name", "Park Supply"); a.click("button[type=submit]"); a.wait_for_url("**/dashboard")
    for f in [sales(), inventory()]:
        a.goto(B + "/data"); a.set_input_files("input[type=file]", str(f)); a.wait_for_url("**/data/*", timeout=90_000)

    # 0. The tick endpoint requires the secret
    assert requests.post(B + "/api/cron/tick", timeout=30).status_code == 401
    assert requests.post(B + "/api/cron/tick", headers={"Authorization": "Bearer wrong-secret-000000000"}, timeout=30).status_code == 401

    # 1. Daily briefing: create, run now, notification
    wid = create(a, "Morning briefing", "orders 2y", "briefing")
    expect(a.get_by_text("Every day at 8:00 AM (America/New_York)")).to_be_visible()
    nxt = q("select next_run_at from workflows where id=%s", wid)[0][0]
    assert nxt.astimezone(__import__("zoneinfo").ZoneInfo("America/New_York")).hour == 8
    run_now(a)
    latest = a.locator("section[aria-labelledby=latest]")
    expect(latest).to_contain_text("Sunday, Sep 27, 2026, compared with Sunday, Sep 20, 2026")
    expect(latest).to_contain_text("Upload newer data")             # the data ends weeks ago: say so
    expect(latest.locator("dl")).to_contain_text("Revenue")
    expect(latest.locator("li [data-fact]").first).to_be_visible()   # summary figures come from engine facts
    expect(a.locator("[data-unread-count]")).to_have_text("1")
    a.screenshot(path=str(SHOTS / "p8-1-briefing.png"), full_page=True)
    a.goto(B + "/notifications")
    expect(a.locator("li[data-unread]").first).to_contain_text("Morning briefing: Sunday, Sep 27, 2026")

    # 2. Scheduled run through the tick; next run moves forward
    q("update workflows set next_run_at = now() - interval '1 minute' where id=%s", wid)
    r = tick(); assert r.status_code == 200 and any(x["workflowId"] == wid for x in r.json()["ran"]), r.text
    assert q("select count(*) from workflow_executions where workflow_id=%s and trigger='schedule' and status='succeeded'", wid)[0][0] == 1
    assert q("select next_run_at > now() from workflows where id=%s", wid)[0][0]

    # Two ticks at the same moment: the occurrence runs exactly once
    q("update workflows set next_run_at = date_trunc('second', now()) - interval '2 minutes' where id=%s", wid)
    occurrence = q("select next_run_at from workflows where id=%s", wid)[0][0]
    results = []
    threads = [threading.Thread(target=lambda: results.append(tick())) for _ in range(2)]
    [t.start() for t in threads]; [t.join() for t in threads]
    assert all(x.status_code == 200 for x in results)
    assert q("select count(*) from workflow_executions where workflow_id=%s and scheduled_for=%s", wid, occurrence)[0][0] == 1

    # 3. Alert: monthly revenue falls 10%+ (August, with the Northeast collapse)
    def change_alert(pg):
        pg.locator("select[name=alertMode]").select_option("change")
        pg.locator("select[name=direction]").select_option("down")
        pg.fill("input[name=thresholdPct]", "10")
        pg.locator("select[name=dayOfMonth]").select_option("1")
    aid = create(a, "Revenue drop", "orders 2y", "alert", "monthly", change_alert)
    run_now(a)
    expect(a.locator("section[aria-labelledby=latest]")).to_contain_text("Alert triggered")
    expect(a.locator("section[aria-labelledby=latest]")).to_contain_text("August 2026 vs July 2026")
    unread = int(a.locator("[data-unread-count]").inner_text())
    run_now(a)   # same data: no repeat notification
    expect(a.locator("section[aria-labelledby=latest]")).to_contain_text("Same result as the previous run")
    assert int(a.locator("[data-unread-count]").inner_text()) == unread

    # 4. Rows alert on the inventory file: on hand below reorder point
    def rows_alert(pg):
        pg.locator("select[name=alertMode]").select_option("rows")
        pg.locator("select[name=column]").select_option("On hand")
        pg.locator("select[name=op]").select_option("lt")
        pg.locator("select[name=valueColumn]").select_option("Reorder point")
        pg.locator("select[name=labelColumn]").select_option("SKU")
    create(a, "Low stock", "inventory", "alert", "daily", rows_alert)
    run_now(a)
    latest = a.locator("section[aria-labelledby=latest]")
    expect(latest).to_contain_text("3 rows with On hand below Reorder point")
    for sku in ["TL-1001", "GD-2001", "PT-3001"]:
        expect(latest).to_contain_text(sku)
    for sku in ["TL-1002", "GD-2010"]:          # 40 vs 15 and 25 vs 20: not below
        expect(latest).not_to_contain_text(sku)

    # 5. Weekly review produces a briefing and a full report
    rid = create(a, "Monday review", "orders 2y", "weekly_review", extra=lambda pg: pg.locator("select[name=weekday]").select_option("1"))
    expect(a.get_by_text("Every Monday at 8:00 AM (America/New_York)")).to_be_visible()
    run_now(a)
    link = a.get_by_role("link", name="Open the report")
    expect(link).to_be_visible(); link.click(); a.wait_for_url("**/reports/*")
    expect(a.get_by_role("heading", name="Executive summary")).to_be_visible()

    # 6. A workflow that can't work pauses itself after five failures
    bad = create(a, "Broken briefing", "inventory", "briefing")
    for _ in range(5):
        run_now(a)
    expect(a.get_by_text("Paused after repeated failures")).to_be_visible()
    assert q("select enabled, consecutive_failures from workflows where id=%s", bad)[0] == (False, 5)
    a.goto(B + "/notifications")
    expect(a.get_by_text("Paused: Broken briefing")).to_be_visible()
    a.get_by_role("button", name="Mark all as read").click()
    expect(a.locator("[data-unread-count]")).to_have_count(0)

    # 7. Dashboard shows the latest briefing
    a.goto(B + "/dashboard")
    expect(a.locator("section[aria-labelledby=briefing]")).to_contain_text("Monday review")

    # 8. Another workspace sees none of it
    b = br.new_context().new_page()
    b.goto(B + "/signup")
    b.fill("#name", "Omar Diaz"); b.fill("#email", f"omar-{RUN}@example.com"); b.fill("#password", "phase8-password!")
    b.click("button[type=submit]"); b.wait_for_url("**/onboarding")
    b.fill("#name", "Diaz Foods"); b.click("button[type=submit]"); b.wait_for_url("**/dashboard")
    b.goto(B + f"/workflows/{wid}"); expect(b.get_by_text("Page not found")).to_be_visible()
    b.goto(B + "/notifications"); expect(b.get_by_text("No notifications yet.")).to_be_visible()
    br.close()
print("ALL PHASE 8 E2E CHECKS PASSED")
