"""Phase 2 end-to-end suite: upload, profile, failures, deletion, tenant isolation.

Needs the web app (production build), the data engine and PostgreSQL running. PowerShell:
    pip install playwright "psycopg[binary]" pandas openpyxl
    playwright install chromium
    $env:E2E_BASE_URL = "http://localhost:3000"
    python apps/web/e2e/phase2_e2e.py
Set E2E_ENGINE_CONTROL=1 only where the script may stop/start the engine itself (CI).
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
TMP = Path(tempfile.mkdtemp())
RUN = uuid.uuid4().hex[:6]


def q(sql, *args):
    with psycopg.connect(DB_URL, autocommit=True) as c:
        cur = c.execute(sql, args)
        return cur.fetchall() if cur.description else None


def messy_sales_csv() -> Path:
    rows = ["Order ID,Order Date,Customer ID,Region,Units,Revenue,Notes"]
    regions = ["Northeast", "South", "West", "Midwest"]
    for i in range(240):
        d = f"2026-{1 + i // 30:02d}-{1 + i % 28:02d}"
        units = 1 + (i * 7) % 12
        rev = units * 24.5
        rows.append(f"ORD-{i:04d},{d},C{(i * 13) % 40:03d},{regions[i % 4]},{units},\"${rev:,.2f}\",{'' if i % 9 else 'rush'}")
    rows.append(rows[1]); rows.append(rows[2])  # 2 duplicates
    rows.append('ORD-9999,2026-08-15,C001,West,3,"$48,000.00",')  # outlier
    p = TMP / "Q3 sales_export.csv"; p.write_text("\n".join(rows) + "\n", encoding="utf-8"); return p


def workbook() -> Path:
    p = TMP / "inventory.xlsx"
    with pd.ExcelWriter(p) as w:
        pd.DataFrame({"sku": [f"SKU{i}" for i in range(30)], "stock": range(30), "price": [9.99] * 30}).to_excel(w, sheet_name="Stock", index=False)
        pd.DataFrame({"x": [1]}).to_excel(w, sheet_name="Notes", index=False)
    return p


def fake_csv() -> Path:
    p = TMP / "contacts.csv"; p.write_bytes(b"%PDF-1.7\x00\x00\x01binary"); return p


def signup(page, name, email, ws):
    page.goto(B + "/signup")
    page.fill("#name", name); page.fill("#email", email); page.fill("#password", "phase2-password!")
    page.click("button[type=submit]"); page.wait_for_url("**/onboarding")
    page.fill("#name", ws); page.click("button[type=submit]"); page.wait_for_url("**/dashboard")


def upload(page, path: Path):
    page.goto(B + "/data")
    page.set_input_files("input[type=file]", str(path))


with sync_playwright() as p:
    br = p.chromium.launch()
    # Unauthenticated API call is refused
    anon = br.new_context().request.post(B + "/api/datasets", multipart={"file": {"name": "a.csv", "mimeType": "text/csv", "buffer": b"a\n1\n"}})
    assert anon.status == 401, anon.status

    a = br.new_context(viewport={"width": 1360, "height": 900}).new_page()
    signup(a, "Dana Ortiz", f"dana-{RUN}@example.com", "Ortiz Outdoor Supply")
    a.goto(B + "/data"); expect(a.get_by_text("No datasets yet.")).to_be_visible()
    a.screenshot(path=str(SHOTS / "p2-1-data-empty.png"))

    # 1. Messy CSV -> profile page
    upload(a, messy_sales_csv())
    a.wait_for_url("**/data/*", timeout=60_000)
    expect(a.get_by_role("heading", name="Q3 sales export")).to_be_visible()
    body = a.content()
    for text in ["243", "Duplicate rows", "Quality score", "converted from text with currency symbols", "Money · revenue", "ID · customer", "Location · region", "Quantity · quantity", "2 duplicate rows"]:
        assert text in body, f"missing on profile page: {text}"
    a.screenshot(path=str(SHOTS / "p2-2-profile.png"), full_page=True)
    ds_a = a.url.rsplit("/", 1)[1]
    row = q("select status, row_count, column_count, quality_score from datasets where id=%s", ds_a)[0]
    assert row[0] == "ready" and row[1] == 243 and row[2] == 7 and 0 < row[3] < 100, row
    roles = dict(q("select name, semantic_role from dataset_columns where dataset_id=%s", ds_a))
    assert roles["Revenue"] == "monetary" and roles["Order Date"] == "time" and roles["Customer ID"] == "identifier", roles

    # 2. Excel workbook, first sheet + note about the others
    upload(a, workbook()); a.wait_for_url("**/data/*", timeout=60_000)
    expect(a.get_by_text("Other sheets: Notes")).to_be_visible()

    # 3. Binary data disguised as CSV: clear error, dataset marked failed
    upload(a, fake_csv())
    expect(a.locator("p[role=alert]")).to_contain_text("binary data")
    assert q("select status from datasets where original_filename='contacts.csv'")[0][0] == "failed"
    a.screenshot(path=str(SHOTS / "p2-3-rejected.png"))

    # 4. Unsupported type is stopped in the browser before uploading
    pdf = TMP / "report.pdf"; pdf.write_bytes(b"%PDF")
    upload(a, pdf); expect(a.locator("p[role=alert]")).to_contain_text("Upload a CSV, Excel")

    a.goto(B + "/data"); a.screenshot(path=str(SHOTS / "p2-4-data-list.png"), full_page=True)
    a.goto(B + "/dashboard"); expect(a.get_by_text("You uploaded a dataset").first).to_be_visible()

    # 5. Tenant isolation: another user can't see or delete A's dataset
    b = br.new_context().new_page()
    signup(b, "Eli Park", f"eli-{RUN}@example.com", "Park Motors")
    b.goto(B + f"/data/{ds_a}"); expect(b.get_by_text("Page not found")).to_be_visible()
    b.goto(B + "/data"); assert "Q3 sales export" not in b.content()
    # forge a delete using B's session against A's dataset id
    b.goto(B + "/data"); upload(b, messy_sales_csv()); b.wait_for_url("**/data/*", timeout=60_000)
    b.eval_on_selector("input[name=datasetId]", f"el => el.value = '{ds_a}'")
    b.on("dialog", lambda d: d.accept())
    b.get_by_role("button", name="Delete dataset").click(); b.wait_for_url("**/data")
    assert q("select deleted_at from datasets where id=%s", ds_a)[0][0] is None, "B deleted A's dataset!"

    # 6. A deletes their own dataset
    a.goto(B + f"/data/{ds_a}"); a.on("dialog", lambda d: d.accept())
    a.get_by_role("button", name="Delete dataset").click(); a.wait_for_url("**/data?deleted=1")
    assert q("select deleted_at is not null from datasets where id=%s", ds_a)[0][0] is True
    a.goto(B + f"/data/{ds_a}"); expect(a.get_by_text("Page not found")).to_be_visible()

    # 7. Engine outage: friendly message, dataset marked failed (only when allowed to control the engine)
    if os.environ.get("E2E_ENGINE_CONTROL") == "1":
        os.system(os.environ["E2E_ENGINE_STOP"])
        upload(a, messy_sales_csv())
        expect(a.locator("p[role=alert]")).to_contain_text("data engine isn't reachable")
        os.system(os.environ["E2E_ENGINE_START"])
        print("engine outage handled")
    br.close()
print("ALL PHASE 2 E2E CHECKS PASSED")
