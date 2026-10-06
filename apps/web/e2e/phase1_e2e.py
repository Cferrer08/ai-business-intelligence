"""Phase 1 end-to-end suite: auth, onboarding, workspaces, sign-out, stale sessions, tenant isolation.

Run against a production build with an EMPTY database. PowerShell:
    pip install playwright "psycopg[binary]"
    playwright install chromium
    $env:E2E_BASE_URL = "http://localhost:3000"
    python apps/web/e2e/phase1_e2e.py

DATABASE_URL defaults to the local docker-compose database.
"""
import os
import psycopg
from playwright.sync_api import sync_playwright, expect

B=os.environ.get("E2E_BASE_URL","http://localhost:3000")
DB_URL=os.environ.get("DATABASE_URL","postgresql://insight:insight@127.0.0.1:5432/insight_ai")
def psql(q):
    """Run one statement; return rows as 'a|b' lines, like psql -tA."""
    with psycopg.connect(DB_URL, autocommit=True) as conn:
        cur = conn.execute(q)
        if cur.description is None:
            return ""
        return "\n".join("|".join("t" if v is True else "f" if v is False else str(v) for v in row) for row in cur.fetchall())

os.makedirs(os.environ.get("E2E_SHOTS","e2e-shots"), exist_ok=True)
with sync_playwright() as p:
    br=p.chromium.launch()
    # --- User A
    a=br.new_context(viewport={"width":1360,"height":860}).new_page()
    a.goto(B); a.screenshot(path=os.environ.get("E2E_SHOTS","e2e-shots")+"/1-landing.png", full_page=True)
    a.goto(B+"/signup")
    a.fill("#name","Ana Ruiz"); a.fill("#email","short"); a.fill("#password","short"); a.click("button[type=submit]")
    expect(a.get_by_text("Enter a valid email address.")).to_be_visible()
    expect(a.get_by_text("Use at least 10 characters.")).to_be_visible()
    a.screenshot(path=os.environ.get("E2E_SHOTS","e2e-shots")+"/2-signup-errors.png")
    expect(a.locator("#name")).to_have_value("Ana Ruiz")  # input survives validation errors
    a.fill("#email","  Ana@Example.com "); a.fill("#password","supersecret123"); a.click("button[type=submit]")
    a.wait_for_url("**/onboarding"); a.screenshot(path=os.environ.get("E2E_SHOTS","e2e-shots")+"/3-onboarding.png")
    a.fill("#name","Northside Retail"); a.click("button[type=submit]")
    a.wait_for_url("**/dashboard")
    expect(a.get_by_role("heading", name="Northside Retail")).to_be_visible()
    expect(a.get_by_text("You created the workspace")).to_be_visible()
    a.screenshot(path=os.environ.get("E2E_SHOTS","e2e-shots")+"/4-dashboard.png", full_page=True)
    # stored email normalized; password hashed
    assert psql("select email from users") == "ana@example.com"
    assert psql("select password_hash like '$2a$12$%' from users") == "t"
    assert len(psql("select token_hash from sessions limit 1")) == 64
    # rename
    a.goto(B+"/settings"); a.fill("#name","Northside Retail Group"); a.get_by_role("button", name="Save name").click()
    expect(a.get_by_role("status")).to_have_text("Saved")
    a.screenshot(path=os.environ.get("E2E_SHOTS","e2e-shots")+"/5-settings.png", full_page=True)
    # upcoming section is honest
    a.goto(B+"/workflows"); expect(a.get_by_text("Not built yet: arrives in phase 8")).to_be_visible()
    a.goto(B+"/nonsense"); expect(a.get_by_text("Page not found")).to_be_visible()
    wsA=psql("select id from workspaces where name='Northside Retail Group'")
    # logout -> session row deleted
    a.goto(B+"/dashboard"); a.click("text=Sign out"); a.wait_for_url("**/login")
    assert psql("select count(*) from sessions") == "0"
    a.goto(B+"/dashboard"); a.wait_for_url("**/login?next=%2Fdashboard")
    # wrong password, then right password honoring ?next
    a.fill("#email","ana@example.com"); a.fill("#password","wrongpassword1"); a.click("button[type=submit]")
    expect(a.get_by_text("That email and password don't match an account.")).to_be_visible()
    a.fill("#password","supersecret123"); a.click("button[type=submit]"); a.wait_for_url("**/dashboard")
    # signed-in user visiting /login is sent to the dashboard by a real session check
    a.goto(B+"/login"); a.wait_for_url("**/dashboard")
    # regression: session revoked server-side while the browser keeps the cookie -> no redirect loop
    psql("delete from sessions")
    a.goto(B+"/dashboard"); a.wait_for_url("**/login?next=%2Fdashboard")
    expect(a.get_by_role("heading", name="Sign in")).to_be_visible()
    a.fill("#email","ana@example.com"); a.fill("#password","supersecret123"); a.click("button[type=submit]"); a.wait_for_url("**/dashboard")
    print("A ok, workspace", wsA)

    # --- User B: tenant isolation
    b=br.new_context(viewport={"width":1360,"height":860}).new_page()
    b.goto(B+"/signup"); b.fill("#name","Ben Cole"); b.fill("#email","ben@example.com"); b.fill("#password","anotherpass99"); b.click("button[type=submit]")
    b.wait_for_url("**/onboarding"); b.fill("#name","Cole Motors"); b.click("button[type=submit]"); b.wait_for_url("**/dashboard")
    b.goto(B+"/onboarding?new=1"); b.fill("#name","Cole Motors East"); b.click("button[type=submit]"); b.wait_for_url("**/dashboard")
    # Use B's real switcher form but forge the workspace id to A's
    b.click("summary")
    b.eval_on_selector("input[name=workspaceId]", f"el => el.value = '{wsA}'")
    b.locator("ul button").first.click(); b.wait_for_load_state("networkidle")
    b.goto(B+"/dashboard")
    expect(b.get_by_role("heading", name="Northside Retail Group")).to_have_count(0)
    assert "Northside" not in b.content()
    b.goto(B+"/settings"); assert "ana@example.com" not in b.content()
    active=psql("select w.name from sessions s join users u on u.id=s.user_id left join workspaces w on w.id=s.active_workspace_id where u.email='ben@example.com'")
    assert "Northside" not in active, active
    print("isolation ok; B active:", active)
    b.screenshot(path=os.environ.get("E2E_SHOTS","e2e-shots")+"/6-dashboard-B.png")

    # duplicate signup
    c=br.new_context().new_page(); c.goto(B+"/signup")
    c.fill("#name","X"); c.fill("#email","BEN@example.com"); c.fill("#password","anotherpass99"); c.click("button[type=submit]")
    expect(c.get_by_text("Already registered. Sign in instead.")).to_be_visible()

    # mobile
    m=br.new_context(viewport={"width":390,"height":844}).new_page(); m.goto(B); m.screenshot(path=os.environ.get("E2E_SHOTS","e2e-shots")+"/7-landing-mobile.png", full_page=True)
    br.close()
print("audit:", psql("select action, count(*) from audit_logs group by 1 order by 1"))
print("ALL E2E CHECKS PASSED")
